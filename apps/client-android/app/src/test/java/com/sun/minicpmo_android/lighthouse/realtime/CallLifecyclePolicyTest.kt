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

    @Test
    fun acceptedMediaFailureExplainsThatCompanionshipStopped() {
        val answered = CallLifecyclePolicy.initial()
            .transition(CallLifecycleEvent.IncomingDiscovered("session-1"))
            .transition(CallLifecycleEvent.LocalAnswerConfirmed("session-1"))

        assertTrue(answered.remoteFailureMessage().contains("已现场接听"))
        assertTrue(answered.remoteFailureMessage().contains("陪伴模型已停止"))
        assertEquals("已接听，但通话连接失败", answered.remoteFailureTitle())
    }

    @Test
    fun preAnswerFailureDoesNotClaimThatMediaOpened() {
        val ringing = CallLifecyclePolicy.initial()
            .transition(CallLifecycleEvent.IncomingDiscovered("session-1"))

        assertTrue(ringing.remoteFailureMessage().contains("摄像头和麦克风未开启"))
        assertFalse(ringing.remoteFailureMessage().contains("已现场接听"))
        assertEquals("通话未能建立", ringing.remoteFailureTitle())
    }
}
