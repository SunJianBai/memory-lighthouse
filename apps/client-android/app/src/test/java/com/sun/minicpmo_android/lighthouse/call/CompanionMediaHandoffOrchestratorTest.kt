package com.sun.minicpmo_android.lighthouse.call

import com.sun.minicpmo_android.lighthouse.model.DeviceMediaDirective
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionMediaHandoffOrchestratorTest {
    @Test
    fun ringingAndContinueDoNotRequestLocalMediaStop() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        orchestrator.applyMediaDirective(DeviceMediaDirective.CONTINUE, "session-a")

        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun remoteAnswerWaitsForLocalAiStopBeforeAccepting() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        val order = mutableListOf<String>()
        orchestrator.attachLocalStopConsumer()

        val handoff = launch(start = CoroutineStart.UNDISPATCHED) {
            orchestrator.handoffForRemoteAnswer("remote-1") {
                order += "server-accept"
            }
        }
        val stopping = orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
        assertEquals(CompanionMediaStopReason.REMOTE_ANSWER, stopping.reason)
        assertTrue(order.isEmpty())

        order += "local-ai-stopped"
        orchestrator.completeLocalStop(stopping.requestId)
        handoff.join()

        assertEquals(listOf("local-ai-stopped", "server-accept"), order)
        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun stopDirectiveUsesTheSameStopHandshakeWithoutAccepting() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        val stop = launch(start = CoroutineStart.UNDISPATCHED) {
            orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, "session-a")
        }
        val stopping = orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
        assertEquals(CompanionMediaStopReason.SERVER_DIRECTIVE, stopping.reason)
        assertEquals("session-a", stopping.sessionId)

        orchestrator.completeLocalStop(stopping.requestId)
        stop.join()

        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun activeCompanionHeartbeatFailureFailsClosed() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        val stop = launch(start = CoroutineStart.UNDISPATCHED) {
            orchestrator.applyHeartbeatFailure("session-a")
        }
        val stopping = orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
        assertEquals(CompanionMediaStopReason.SERVER_DIRECTIVE, stopping.reason)
        assertEquals("session-a", stopping.sessionId)

        orchestrator.completeLocalStop(stopping.requestId)
        stop.join()
        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun anUntargetedStopDoesNotCreateAStopRequest() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, null)

        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun aStopForANewerSessionIsNotSuppressedByAnEarlierSessionStop() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        val stopA = launch(start = CoroutineStart.UNDISPATCHED) {
            orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, "session-a")
        }
        val stoppingA =
            orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
        orchestrator.completeLocalStop(stoppingA.requestId)
        stopA.join()

        val stopB = launch(start = CoroutineStart.UNDISPATCHED) {
            orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, "session-b")
        }
        val stoppingB =
            orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
        orchestrator.completeLocalStop(stoppingB.requestId)
        stopB.join()

        assertTrue(stoppingB.requestId > stoppingA.requestId)
        assertEquals("session-b", stoppingB.sessionId)
    }

    @Test
    fun repeatedStopForTheSameSessionIsSuppressed() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        val first = launch(start = CoroutineStart.UNDISPATCHED) {
            orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, "session-a")
        }
        val stopping = orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
        orchestrator.completeLocalStop(stopping.requestId)
        first.join()

        orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, "session-a")

        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun continueForAnOldSessionDoesNotResetTheCurrentSessionLatch() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        suspend fun completeStop(sessionId: String) {
            val stop = launch(start = CoroutineStart.UNDISPATCHED) {
                orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, sessionId)
            }
            val stopping =
                orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
            orchestrator.completeLocalStop(stopping.requestId)
            stop.join()
        }

        completeStop("session-a")
        completeStop("session-b")
        orchestrator.applyMediaDirective(DeviceMediaDirective.CONTINUE, "session-a")
        orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, "session-b")

        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun anAttachedConsumerThatNeverAcknowledgesTimesOutAndReleasesTheHandoff() = runTest {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        val result = runCatching {
            orchestrator.applyMediaDirective(DeviceMediaDirective.STOP, "session-a")
        }

        assertTrue(result.exceptionOrNull() is TimeoutCancellationException)
        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }
}
