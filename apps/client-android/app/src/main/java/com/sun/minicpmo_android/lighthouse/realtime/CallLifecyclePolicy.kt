package com.sun.minicpmo_android.lighthouse.realtime

enum class CallLifecyclePhase { IDLE, RINGING, ACCEPTING, ACTIVE, ENDED, ERROR }

sealed interface CallLifecycleEvent {
    data class IncomingDiscovered(val sessionId: String) : CallLifecycleEvent
    data class LocalAnswerConfirmed(val sessionId: String) : CallLifecycleEvent
    data class MediaConnected(val sessionId: String) : CallLifecycleEvent
    data class LocalDecline(val sessionId: String) : CallLifecycleEvent
    data class LocalHangup(val sessionId: String) : CallLifecycleEvent
    data class AuthorizationRevoked(val sessionId: String) : CallLifecycleEvent
    data class Failed(val sessionId: String, val reason: String) : CallLifecycleEvent
    data object UiBecameBackground : CallLifecycleEvent
}

data class CallLifecycleState(
    val phase: CallLifecyclePhase,
    val sessionId: String? = null,
    val locallyAnswered: Boolean = false,
    val mediaReleaseRequired: Boolean = false,
) {
    val mediaForegroundAllowed: Boolean
        get() = locallyAnswered && phase in setOf(
            CallLifecyclePhase.ACCEPTING,
            CallLifecyclePhase.ACTIVE,
        )

    fun transition(event: CallLifecycleEvent): CallLifecycleState = when (event) {
        is CallLifecycleEvent.IncomingDiscovered -> when (phase) {
            CallLifecyclePhase.IDLE,
            CallLifecyclePhase.ENDED,
            CallLifecyclePhase.ERROR,
            -> CallLifecycleState(CallLifecyclePhase.RINGING, event.sessionId)
            else -> this
        }
        is CallLifecycleEvent.LocalAnswerConfirmed ->
            if (phase == CallLifecyclePhase.RINGING && sessionId == event.sessionId) {
                copy(phase = CallLifecyclePhase.ACCEPTING, locallyAnswered = true)
            } else {
                this
            }
        is CallLifecycleEvent.MediaConnected ->
            if (
                phase == CallLifecyclePhase.ACCEPTING &&
                locallyAnswered &&
                sessionId == event.sessionId
            ) {
                copy(phase = CallLifecyclePhase.ACTIVE)
            } else {
                this
            }
        is CallLifecycleEvent.LocalDecline -> terminal(event.sessionId, CallLifecyclePhase.ENDED)
        is CallLifecycleEvent.LocalHangup -> terminal(event.sessionId, CallLifecyclePhase.ENDED)
        is CallLifecycleEvent.AuthorizationRevoked -> terminal(event.sessionId, CallLifecyclePhase.ENDED)
        is CallLifecycleEvent.Failed -> terminal(event.sessionId, CallLifecyclePhase.ERROR)
        CallLifecycleEvent.UiBecameBackground -> this
    }

    private fun terminal(expectedSessionId: String, terminalPhase: CallLifecyclePhase) =
        if (sessionId == expectedSessionId) {
            copy(
                phase = terminalPhase,
                locallyAnswered = false,
                mediaReleaseRequired = true,
            )
        } else {
            this
        }
}

fun CallLifecycleState.remoteFailureTitle(): String =
    if (locallyAnswered) "已接听，但通话连接失败" else "通话未能建立"

fun CallLifecycleState.remoteFailureMessage(): String =
    if (locallyAnswered) {
        "已现场接听，但实时音视频连接失败；陪伴模型已停止。请结束本次提示并让家属重新发起通话。"
    } else {
        "本次通话未能建立，摄像头和麦克风未开启。请让家属重新发起通话。"
    }

object CallLifecyclePolicy {
    fun initial() = CallLifecycleState(CallLifecyclePhase.IDLE)
}
