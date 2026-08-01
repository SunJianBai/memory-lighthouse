package com.sun.minicpmo_android.lighthouse.realtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallLifecyclePolicyTest {
    @Test
    fun mediaCanStartOnlyAfterAnExplicitLocalAnswer() {
        val ringing = CallLifecyclePolicy.initial()
            .transition(CallLifecycleEvent.IncomingDiscovered("session-1"))

        assertEquals(CallLifecyclePhase.RINGING, ringing.phase)
        assertFalse(ringing.mediaForegroundAllowed)

        val answered = ringing.transition(CallLifecycleEvent.LocalAnswerConfirmed("session-1"))

        assertEquals(CallLifecyclePhase.ACCEPTING, answered.phase)
        assertTrue(answered.mediaForegroundAllowed)
    }

    @Test
    fun backgroundingAndLockingTheActivityDoNotEndAnAcceptedCall() {
        val active = CallLifecyclePolicy.initial()
            .transition(CallLifecycleEvent.IncomingDiscovered("session-1"))
            .transition(CallLifecycleEvent.LocalAnswerConfirmed("session-1"))
            .transition(CallLifecycleEvent.MediaConnected("session-1"))

        assertEquals(active, active.transition(CallLifecycleEvent.UiBecameBackground))
    }

    @Test
    fun everyTerminalPathRequiresMediaRelease() {
        val active = CallLifecyclePolicy.initial()
            .transition(CallLifecycleEvent.IncomingDiscovered("session-1"))
            .transition(CallLifecycleEvent.LocalAnswerConfirmed("session-1"))
            .transition(CallLifecycleEvent.MediaConnected("session-1"))

        listOf(
            CallLifecycleEvent.LocalHangup("session-1"),
            CallLifecycleEvent.AuthorizationRevoked("session-1"),
            CallLifecycleEvent.Failed("session-1", "network"),
        ).forEach { event ->
            val terminal = active.transition(event)
            assertTrue(event.toString(), terminal.mediaReleaseRequired)
            assertFalse(event.toString(), terminal.mediaForegroundAllowed)
        }
    }

    @Test
    fun rejectingNeverAllowsMedia() {
        val declined = CallLifecyclePolicy.initial()
            .transition(CallLifecycleEvent.IncomingDiscovered("session-1"))
            .transition(CallLifecycleEvent.LocalDecline("session-1"))

        assertEquals(CallLifecyclePhase.ENDED, declined.phase)
        assertFalse(declined.mediaForegroundAllowed)
        assertTrue(declined.mediaReleaseRequired)
    }
}
