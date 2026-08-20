package com.sun.minicpmo_android.lighthouse.call

import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

enum class RemoteHeartbeatConnectionState {
    CONNECTED,
    RECONNECTING,
    DISCONNECTED,
}

internal class RemoteHeartbeatRetryExhaustedException(
    val lastFailure: Throwable,
) : IOException("remote heartbeat could not reconnect before the safe lease deadline", lastFailure)

internal class RemoteHeartbeatLeaseGuard(
    private val renewHeartbeat: suspend (String) -> Unit,
    private val onLeaseLost: suspend (String, Throwable) -> Unit,
    private val onConnectionStateChanged: (RemoteHeartbeatConnectionState) -> Unit = {},
    private val nowMillis: () -> Long = { System.nanoTime() / NANOS_PER_MILLISECOND },
    initialSuccessfulRenewalAtMillis: Long = nowMillis(),
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val retryDelaysMillis: List<Long> = DEFAULT_RETRY_DELAYS_MILLIS,
    private val leaseTtlMillis: Long = DEFAULT_LEASE_TTL_MILLIS,
    private val leaseSafetyMarginMillis: Long = DEFAULT_LEASE_SAFETY_MARGIN_MILLIS,
) {
    private var lastSuccessfulRenewalAtMillis = initialSuccessfulRenewalAtMillis
    private var connectionState: RemoteHeartbeatConnectionState? = null

    init {
        require(leaseTtlMillis > 0) { "leaseTtlMillis must be positive" }
        require(leaseSafetyMarginMillis in 0 until leaseTtlMillis) {
            "leaseSafetyMarginMillis must leave a positive renewal window"
        }
        require(retryDelaysMillis.all { it >= 0 }) { "retry delays must not be negative" }
    }

    suspend fun renew(sessionId: String): Boolean {
        val renewalDeadline = lastSuccessfulRenewalAtMillis +
            leaseTtlMillis - leaseSafetyMarginMillis
        var retryIndex = 0
        var lastError: Throwable = IOException("remote heartbeat lease expired")

        while (true) {
            val attemptStartedAtMillis = nowMillis()
            val remainingMillis = renewalDeadline - attemptStartedAtMillis
            if (remainingMillis <= 0) {
                return loseLease(sessionId, RemoteHeartbeatRetryExhaustedException(lastError))
            }

            val attempt = withTimeoutOrNull(remainingMillis) {
                try {
                    renewHeartbeat(sessionId)
                    HeartbeatAttempt.Success
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Throwable) {
                    HeartbeatAttempt.Failure(error)
                }
            } ?: HeartbeatAttempt.Failure(
                IOException("remote heartbeat did not finish before the safe lease deadline"),
            )

            when (attempt) {
                HeartbeatAttempt.Success -> {
                    // The server renews while handling the request, before the
                    // response reaches this client. Anchoring to response time
                    // could move our safety deadline past the real 90s expiry.
                    lastSuccessfulRenewalAtMillis = attemptStartedAtMillis
                    publishState(RemoteHeartbeatConnectionState.CONNECTED)
                    return true
                }
                is HeartbeatAttempt.Failure -> {
                    lastError = attempt.error
                    if (!attempt.error.isRetryableHeartbeatFailure()) {
                        return loseLease(sessionId, attempt.error)
                    }
                    publishState(RemoteHeartbeatConnectionState.RECONNECTING)
                }
            }

            val retryDelayMillis = retryDelaysMillis.getOrNull(retryIndex++)
                ?: return loseLease(
                    sessionId,
                    RemoteHeartbeatRetryExhaustedException(lastError),
                )
            val remainingAfterAttempt = renewalDeadline - nowMillis()
            if (retryDelayMillis >= remainingAfterAttempt) {
                return loseLease(
                    sessionId,
                    RemoteHeartbeatRetryExhaustedException(lastError),
                )
            }
            sleep(retryDelayMillis)
        }
    }

    private suspend fun loseLease(sessionId: String, error: Throwable): Boolean {
        publishState(RemoteHeartbeatConnectionState.DISCONNECTED)
        onLeaseLost(sessionId, error)
        return false
    }

    private fun publishState(state: RemoteHeartbeatConnectionState) {
        if (connectionState == state) return
        connectionState = state
        onConnectionStateChanged(state)
    }

    private fun Throwable.isRetryableHeartbeatFailure(): Boolean = when (this) {
        is LighthouseApiException -> status == 408 || status == 429 || status in 500..599
        is IOException -> true
        else -> false
    }

    private sealed interface HeartbeatAttempt {
        data object Success : HeartbeatAttempt
        data class Failure(val error: Throwable) : HeartbeatAttempt
    }

    private companion object {
        const val NANOS_PER_MILLISECOND = 1_000_000L
        const val DEFAULT_LEASE_TTL_MILLIS = 90_000L
        const val DEFAULT_LEASE_SAFETY_MARGIN_MILLIS = 15_000L
        val DEFAULT_RETRY_DELAYS_MILLIS = listOf(2_000L, 5_000L, 10_000L, 15_000L)
    }
}
