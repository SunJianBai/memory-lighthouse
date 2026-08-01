package com.sun.minicpmo_android.model

enum class RealtimeMode(val apiValue: String, val label: String) {
    CHAT("chat", "文字"),
    AUDIO("audio", "语音"),
    VIDEO("video", "视频"),
}

enum class SessionPhase {
    IDLE,
    CONNECTING,
    QUEUED,
    PREPARING,
    LIVE,
    PAUSED,
    STOPPED,
    ERROR,
}

enum class MessageRole {
    USER,
    ASSISTANT,
    SYSTEM,
}

data class ConversationMessage(
    val id: Long,
    val role: MessageRole,
    val text: String,
    val responseId: String? = null,
    val streaming: Boolean = false,
)

data class SessionSettings(
    val apiHost: String = "https://minicpmo45.modelbest.cn",
    val systemPrompt: String = "你是 MiniCPM-o，一个友好、简洁且有帮助的多模态助手。请默认使用中文回答。",
    val lengthPenalty: Float = 1.1f,
    val chatTtsEnabled: Boolean = true,
)

data class AppUiState(
    val selectedMode: RealtimeMode = RealtimeMode.CHAT,
    val phase: SessionPhase = SessionPhase.IDLE,
    val statusText: String = "准备就绪",
    val serviceAvailable: Boolean? = null,
    val messages: List<ConversationMessage> = emptyList(),
    val composerText: String = "",
    val settings: SessionSettings = SessionSettings(),
    val settingsVisible: Boolean = false,
    val micEnabled: Boolean = true,
    val forceListen: Boolean = false,
    val audioLevel: Float = 0f,
    val queuePosition: Int? = null,
    val queueWaitSeconds: Int? = null,
    val sessionId: String? = null,
    val lastLatencyMs: Long? = null,
    val lastKvCacheLength: Int? = null,
) {
    val hasActiveSession: Boolean
        get() = phase in setOf(
            SessionPhase.CONNECTING,
            SessionPhase.QUEUED,
            SessionPhase.PREPARING,
            SessionPhase.LIVE,
            SessionPhase.PAUSED,
        )

    val canSendChat: Boolean
        get() = selectedMode == RealtimeMode.CHAT &&
            composerText.isNotBlank() &&
            messages.none { it.streaming } &&
            phase !in setOf(SessionPhase.CONNECTING, SessionPhase.QUEUED, SessionPhase.PREPARING)
}
