package com.sun.minicpmo_android.lighthouse.call

import com.sun.minicpmo_android.lighthouse.model.DeviceMediaDirective
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionMediaHandoffOrchestratorTest {
    @Test
    fun ringingAndContinueDoNotRequestLocalMediaStop() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        orchestrator.applyMediaDirective(DeviceMediaDirective.CONTINUE)

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
            orchestrator.applyMediaDirective(DeviceMediaDirective.STOP)
        }
        val stopping = orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
        assertEquals(CompanionMediaStopReason.SERVER_DIRECTIVE, stopping.reason)

        orchestrator.completeLocalStop(stopping.requestId)
        stop.join()

        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun activeCompanionHeartbeatFailureFailsClosed() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        val stop = launch(start = CoroutineStart.UNDISPATCHED) {
            orchestrator.applyHeartbeatFailure(localCompanionActive = true)
        }
        val stopping = orchestrator.state.value as CompanionMediaHandoffState.StoppingLocalCompanion
        assertEquals(CompanionMediaStopReason.SERVER_DIRECTIVE, stopping.reason)

        orchestrator.completeLocalStop(stopping.requestId)
        stop.join()
        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }

    @Test
    fun idleHeartbeatFailureDoesNotCreateAStopRequest() = runBlocking {
        val orchestrator = CompanionMediaHandoffOrchestrator()
        orchestrator.attachLocalStopConsumer()

        orchestrator.applyHeartbeatFailure(localCompanionActive = false)

        assertEquals(CompanionMediaHandoffState.Idle, orchestrator.state.value)
    }
}
