package com.sun.minicpmo_android.lighthouse.realtime

data class FamilyCallPresentation(
    val title: String,
    val message: String,
    val canConnect: Boolean,
    val mediaFailed: Boolean,
)

fun LiveCallState.isUnexpectedFamilyMediaFailure(sessionId: String): Boolean =
    this.sessionId == sessionId && (
        phase == LiveCallPhase.ERROR ||
            (phase == LiveCallPhase.ENDED && message == "媒体连接已断开")
        )

fun shouldKeepFamilyMediaFailureVisible(
    sessionStatus: String,
    sessionId: String,
    mediaState: LiveCallState,
    failureLatched: Boolean,
): Boolean = failureLatched || (
    sessionStatus != "RINGING" &&
        mediaState.isUnexpectedFamilyMediaFailure(sessionId)
    )

fun presentFamilyCall(
    sessionStatus: String,
    sessionId: String,
    mediaState: LiveCallState,
    failureLatched: Boolean,
): FamilyCallPresentation {
    if (sessionStatus == "RINGING") {
        return FamilyCallPresentation(
            title = "等待陪伴设备现场接听",
            message = "未接听前不会打开陪伴端摄像头或麦克风。",
            canConnect = false,
            mediaFailed = false,
        )
    }
    if (failureLatched || mediaState.isUnexpectedFamilyMediaFailure(sessionId)) {
        return FamilyCallPresentation(
            title = "设备已接听，但媒体连接失败",
            message = "陪伴模型已停止。请结束本次通话后重新发起，不能直接重连。",
            canConnect = false,
            mediaFailed = true,
        )
    }
    if (mediaState.sessionId == sessionId && mediaState.phase == LiveCallPhase.CONNECTING) {
        return FamilyCallPresentation(
            title = "正在连接音视频",
            message = "设备已现场接听，陪伴模型已停止。",
            canConnect = false,
            mediaFailed = false,
        )
    }
    if (mediaState.sessionId == sessionId && mediaState.phase == LiveCallPhase.CONNECTED) {
        return FamilyCallPresentation(
            title = "实时媒体已连接",
            message = "本次通话不录制、不转写。",
            canConnect = false,
            mediaFailed = false,
        )
    }
    return FamilyCallPresentation(
        title = "设备已现场接听",
        message = "现在可以加入本次实时通话；陪伴模型已停止。",
        canConnect = true,
        mediaFailed = false,
    )
}
