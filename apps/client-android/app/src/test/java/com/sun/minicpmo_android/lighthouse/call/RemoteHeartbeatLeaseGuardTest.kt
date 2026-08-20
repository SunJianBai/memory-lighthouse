package com.sun.minicpmo_android.lighthouse.call

import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteHeartbeatLeaseGuardTest {
    @Test
    fun successfulRenewalKeepsTheMediaLease() = runBlocking {
        val states = mutableListOf<RemoteHeartbeatConnectionState>()
        var failureCalled = false
        val guard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = { assertEquals("session-1", it) },
            onLeaseLost = { _, _ -> failureCalled = true },
            onConnectionStateChanged = states::add,
        )

        assertTrue(guard.renew("session-1"))
        assertFalse(failureCalled)
        assertEquals(listOf(RemoteHeartbeatConnectionState.CONNECTED), states)
    }

    @Test
    fun transientNetworkFailureReconnectsWithoutReleasingTheCall() = runBlocking {
        var attempt = 0
        val states = mutableListOf<RemoteHeartbeatConnectionState>()
        var failureCalled = false
        val guard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = {
                attempt += 1
                if (attempt == 1) throw IOException("connection reset")
            },
            onLeaseLost = { _, _ -> failureCalled = true },
            onConnectionStateChanged = states::add,
            sleep = {},
        )

        assertTrue(guard.renew("session-1"))
        assertEquals(2, attempt)
        assertFalse(failureCalled)
        assertEquals(
            listOf(
                RemoteHeartbeatConnectionState.RECONNECTING,
                RemoteHeartbeatConnectionState.CONNECTED,
            ),
            states,
        )
    }

    @Test
    fun retryableHttpFailuresUseTheSameReconnectPath() = runBlocking {
        listOf(408, 429, 500, 503).forEach { status ->
            var attempt = 0
            val guard = RemoteHeartbeatLeaseGuard(
                renewHeartbeat = {
                    attempt += 1
                    if (attempt == 1) {
                        throw LighthouseApiException(status, "HTTP_$status", "temporary")
                    }
                },
                onLeaseLost = { _, _ -> error("must not release a recovered lease") },
                sleep = {},
            )

            assertTrue("HTTP $status should retry", guard.renew("session-$status"))
            assertEquals(2, attempt)
        }
    }

    @Test
    fun authenticationAndAuthorizationFailuresFailClosedImmediately() = runBlocking {
        listOf(
            LighthouseApiException(401, "DEVICE_NOT_ACTIVATED", "revoked"),
            LighthouseApiException(403, "REMOTE_CALL_NOT_ALLOWED", "revoked"),
        ).forEach { leaseError ->
            var attempts = 0
            var releasedError: Throwable? = null
            val states = mutableListOf<RemoteHeartbeatConnectionState>()
            val guard = RemoteHeartbeatLeaseGuard(
                renewHeartbeat = {
                    attempts += 1
                    throw leaseError
                },
                onLeaseLost = { _, error -> releasedError = error },
                onConnectionStateChanged = states::add,
                sleep = { error("must not retry authorization failures") },
            )

            assertFalse(guard.renew("session-1"))
            assertEquals(1, attempts)
            assertSame(leaseError, releasedError)
            assertEquals(listOf(RemoteHeartbeatConnectionState.DISCONNECTED), states)
        }
    }

    @Test
    fun nonRetryableClientFailuresFailClosedWithoutBeingCalledNetworkRecovery() = runBlocking {
        val leaseError = LighthouseApiException(409, "REMOTE_SESSION_TERMINAL", "ended")
        var attempts = 0
        var releasedError: Throwable? = null
        val guard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = {
                attempts += 1
                throw leaseError
            },
            onLeaseLost = { _, error -> releasedError = error },
            sleep = { error("must not retry a terminal remote session") },
        )

        assertFalse(guard.renew("session-1"))
        assertEquals(1, attempts)
        assertSame(leaseError, releasedError)
    }

    @Test
    fun retryBudgetStopsBeforeTheServerLeaseTtl() = runBlocking {
        var now = 0L
        var attempts = 0
        var releasedAt: Long? = null
        var releasedError: Throwable? = null
        val guard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = {
                attempts += 1
                throw IOException("offline")
            },
            onLeaseLost = { _, error ->
                releasedAt = now
                releasedError = error
            },
            nowMillis = { now },
            sleep = { now += it },
            retryDelaysMillis = listOf(20_000L, 20_000L, 20_000L, 20_000L),
            leaseTtlMillis = 90_000L,
            leaseSafetyMarginMillis = 15_000L,
        )

        assertFalse(guard.renew("session-1"))
        assertTrue(attempts > 1)
        assertTrue(requireNotNull(releasedAt) < 90_000L)
        assertTrue(requireNotNull(releasedAt) <= 75_000L)
        assertTrue(releasedError is RemoteHeartbeatRetryExhaustedException)
    }

    @Test
    fun slowSuccessfulResponseDoesNotMoveTheDeadlinePastTheServerExpiry() = runBlocking {
        var now = 0L
        var renewals = 0
        var releasedAt: Long? = null
        val guard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = {
                renewals += 1
                if (renewals == 1) {
                    now += 45_000L
                } else {
                    throw IOException("offline")
                }
            },
            onLeaseLost = { _, _ -> releasedAt = now },
            nowMillis = { now },
            sleep = { now += it },
            retryDelaysMillis = listOf(20_000L, 20_000L, 20_000L),
            leaseTtlMillis = 90_000L,
            leaseSafetyMarginMillis = 15_000L,
        )

        assertTrue(guard.renew("session-1"))
        assertFalse(guard.renew("session-1"))
        assertTrue(requireNotNull(releasedAt) <= 75_000L)
    }

    @Test
    fun delayedJoinTicketUsesItsRequestStartAsTheInitialLeaseAnchor() = runBlocking {
        var now = 45_000L
        var releasedAt: Long? = null
        val guard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = { throw IOException("offline after join ticket") },
            onLeaseLost = { _, _ -> releasedAt = now },
            nowMillis = { now },
            initialSuccessfulRenewalAtMillis = 0L,
            sleep = { now += it },
            retryDelaysMillis = listOf(20_000L, 20_000L, 20_000L),
            leaseTtlMillis = 90_000L,
            leaseSafetyMarginMillis = 15_000L,
        )

        assertFalse(guard.renew("session-1"))
        assertTrue(requireNotNull(releasedAt) <= 75_000L)
    }

    @Test(expected = CancellationException::class)
    fun coroutineCancellationIsNotReportedAsLeaseLoss() {
        runBlocking {
            val guard = RemoteHeartbeatLeaseGuard(
                renewHeartbeat = { throw CancellationException("stopped") },
                onLeaseLost = { _, _ -> error("must not be called") },
            )

            guard.renew("session-1")
        }
    }
}
