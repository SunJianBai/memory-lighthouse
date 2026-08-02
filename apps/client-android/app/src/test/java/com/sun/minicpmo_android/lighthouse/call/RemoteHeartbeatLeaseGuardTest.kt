package com.sun.minicpmo_android.lighthouse.call

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
        var failureCalled = false
        val guard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = { assertEquals("session-1", it) },
            onLeaseLost = { _, _ -> failureCalled = true },
        )

        assertTrue(guard.renew("session-1"))
        assertFalse(failureCalled)
    }

    @Test
    fun anyRenewalFailureFailsClosedAndReleasesTheCall() = runBlocking {
        val leaseError = IllegalStateException("control_plane_unavailable")
        var releasedSessionId: String? = null
        var releasedError: Throwable? = null
        val guard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = { throw leaseError },
            onLeaseLost = { sessionId, error ->
                releasedSessionId = sessionId
                releasedError = error
            },
        )

        assertFalse(guard.renew("session-1"))
        assertEquals("session-1", releasedSessionId)
        assertSame(leaseError, releasedError)
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
