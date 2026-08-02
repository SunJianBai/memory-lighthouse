package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import kotlinx.coroutines.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class ActivationPollingPolicyTest {
    @Test
    fun staleRecoveryProofAndRateLimitRemainRetryable() {
        val staleProof = LighthouseApiException(
            status = 409,
            code = "ACTIVATION_ALREADY_CONSUMED",
            message = "proof version was consumed",
        )
        val rateLimited = LighthouseApiException(
            status = 429,
            code = "RATE_LIMITED",
            message = "slow down",
        )
        val versionConflict = LighthouseApiException(
            status = 409,
            code = "ACTIVATION_STATE_CONFLICT",
            message = "fetch the next recovery token",
        )

        assertTrue(shouldRetryActivationPolling(staleProof))
        assertEquals(3_000L, activationPollingRetryDelayMillis(staleProof))
        assertTrue(shouldRetryActivationPolling(versionConflict))
        assertEquals(3_000L, activationPollingRetryDelayMillis(versionConflict))
        assertTrue(shouldRetryActivationPolling(rateLimited))
        assertEquals(10_000L, activationPollingRetryDelayMillis(rateLimited))
    }

    @Test
    fun aStaleProofCanAdvanceToTheNextSuccessfulExchangeAttempt() {
        val outcomes = ArrayDeque<Result<String>>().apply {
            add(
                Result.failure(
                    LighthouseApiException(
                        status = 409,
                        code = "ACTIVATION_ALREADY_CONSUMED",
                        message = "stale recovery token",
                    ),
                ),
            )
            add(Result.success("credential-persisted"))
        }
        var credential: String? = null
        while (credential == null && outcomes.isNotEmpty()) {
            outcomes.removeFirst().fold(
                onSuccess = { credential = it },
                onFailure = {
                    if (!shouldRetryActivationPolling(it)) outcomes.clear()
                },
            )
        }

        assertEquals("credential-persisted", credential)
    }

    @Test
    fun permanentClientErrorsStopWhileServerFailuresRetry() {
        assertFalse(
            shouldRetryActivationPolling(
                LighthouseApiException(400, "ACTIVATION_EXPIRED", "expired"),
            ),
        )
        assertTrue(
            shouldRetryActivationPolling(
                LighthouseApiException(503, "SERVICE_UNAVAILABLE", "retry"),
            ),
        )
        assertTrue(shouldRetryActivationPolling(IOException("offline")))
        assertFalse(shouldRetryActivationPolling(IllegalStateException("keystore unavailable")))
    }

    @Test
    fun terminalChallengeStatusesCannotBeMistakenForWaiting() {
        assertEquals(
            ActivationChallengeDisposition.WAITING,
            activationChallengeDisposition("CLAIMED"),
        )
        assertEquals(
            ActivationChallengeDisposition.EXCHANGE,
            activationChallengeDisposition("CONSUMED"),
        )
        listOf("CANCELLED", "EXPIRED", "ATTEMPTS_EXCEEDED").forEach { status ->
            assertEquals(
                ActivationChallengeDisposition.TERMINAL,
                activationChallengeDisposition(status),
            )
            assertTrue(activationTerminalMessage(status).isNotBlank())
        }
        assertEquals(
            ActivationChallengeDisposition.INVALID,
            activationChallengeDisposition("UNKNOWN"),
        )
    }

    @Test
    fun recoveryConflictsHaveAFiniteRetryBudget() {
        val conflict = LighthouseApiException(
            409,
            "ACTIVATION_ALREADY_CONSUMED",
            "credential does not match",
        )

        assertTrue(shouldRetryActivationPolling(conflict, recoveryConflictAttempts = 1))
        assertFalse(
            shouldRetryActivationPolling(
                conflict,
                recoveryConflictAttempts = MAX_ACTIVATION_RECOVERY_CONFLICTS,
            ),
        )
    }

    @Test
    fun coroutineCancellationEscapesWithoutBecomingAStopDecision() {
        val cancellation = CancellationException("new polling generation started")

        val propagated = assertThrows(CancellationException::class.java) {
            shouldRetryActivationPolling(cancellation)
        }

        assertEquals(cancellation, propagated)
    }
}
