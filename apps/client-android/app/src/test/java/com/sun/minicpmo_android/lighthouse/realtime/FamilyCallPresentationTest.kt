package com.sun.minicpmo_android.lighthouse.realtime

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FamilyCallPresentationTest {
    @Test
    fun acceptedConnectionFailureCannotBeJoinedAgain() {
        val presentation = presentFamilyCall(
            sessionStatus = "ACCEPTED",
            sessionId = "session-1",
            mediaState = LiveCallState(
                phase = LiveCallPhase.ERROR,
                sessionId = "session-1",
            ),
            failureLatched = false,
        )

        assertTrue(presentation.mediaFailed)
        assertFalse(presentation.canConnect)
        assertTrue(presentation.message.contains("不能直接重连"))
        assertTrue(presentation.message.contains("陪伴模型已停止"))
    }

    @Test
    fun failureLatchSurvivesAFollowingServerTerminalState() {
        val presentation = presentFamilyCall(
            sessionStatus = "ENDED",
            sessionId = "session-1",
            mediaState = LiveCallState(
                phase = LiveCallPhase.ENDED,
                sessionId = "session-1",
                message = "DEVICE_ENDED",
            ),
            failureLatched = true,
        )

        assertTrue(presentation.mediaFailed)
        assertFalse(presentation.canConnect)
    }

    @Test
    fun terminalPollingCannotEraseAMediaFailureBeforeTheCollectorLatchesIt() {
        assertTrue(
            shouldKeepFamilyMediaFailureVisible(
                sessionStatus = "FAILED",
                sessionId = "session-1",
                mediaState = LiveCallState(
                    phase = LiveCallPhase.ERROR,
                    sessionId = "session-1",
                ),
                failureLatched = false,
            ),
        )
        assertFalse(
            shouldKeepFamilyMediaFailureVisible(
                sessionStatus = "ENDED",
                sessionId = "session-1",
                mediaState = LiveCallState(
                    phase = LiveCallPhase.CONNECTED,
                    sessionId = "session-1",
                ),
                failureLatched = false,
            ),
        )
    }

    @Test
    fun aPreviousSessionsEndDoesNotBlockTheInitialJoin() {
        val presentation = presentFamilyCall(
            sessionStatus = "ACCEPTED",
            sessionId = "session-2",
            mediaState = LiveCallState(
                phase = LiveCallPhase.ENDED,
                sessionId = "session-1",
            ),
            failureLatched = false,
        )

        assertFalse(presentation.mediaFailed)
        assertTrue(presentation.canConnect)
    }
}
