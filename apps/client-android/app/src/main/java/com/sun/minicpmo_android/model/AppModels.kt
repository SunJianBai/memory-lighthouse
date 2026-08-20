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

enum class DuplexActivity {
    READY,
    LISTENING,
    RESPONDING,
}

enum class MessageRole {
    USER,
    ASSISTANT,
    SYSTEM,
}

const val DEFAULT_LENGTH_PENALTY = 1.0f
private const val LEGACY_DEFAULT_LENGTH_PENALTY = 1.1f
const val CURRENT_SESSION_SETTINGS_VERSION = 2

fun migrateStoredLengthPenalty(
    storedValue: Float?,
    storedSettingsVersion: Int,
): Float = when {
    storedValue == null -> DEFAULT_LENGTH_PENALTY
    storedSettingsVersion < CURRENT_SESSION_SETTINGS_VERSION &&
        kotlin.math.abs(storedValue - LEGACY_DEFAULT_LENGTH_PENALTY) < 0.0001f ->
        DEFAULT_LENGTH_PENALTY
    else -> storedValue
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
    val lengthPenalty: Float = DEFAULT_LENGTH_PENALTY,
    val chatTtsEnabled: Boolean = true,
) {
    fun chatTtsEnabledFor(mode: RealtimeMode): Boolean =
        mode == RealtimeMode.CHAT && chatTtsEnabled
}

data class EffectiveSessionConfiguration(
    val apiHost: String,
    val systemPrompt: String,
    val model: String,
    val promptVersion: Int?,
    val lengthPenalty: Float,
    val memoryCount: Int?,
    val routineCount: Int?,
) {
    val summary: String
        get() {
            val memories = memoryCount?.takeIf { it > 0 }
            val routines = routineCount?.takeIf { it > 0 }
            return when {
                memories != null && routines != null ->
                    "已准备 $memories 条记忆和 $routines 项日程"
                memories != null -> "已准备 $memories 条记忆"
                routines != null -> "已准备 $routines 项日程"
                else -> "陪伴已准备"
            }
        }

    fun connectionSettings(localPreferences: SessionSettings): SessionSettings =
        localPreferences.copy(
            apiHost = apiHost,
            systemPrompt = systemPrompt,
            lengthPenalty = lengthPenalty,
        )
}

data class AppUiState(
    val selectedMode: RealtimeMode = RealtimeMode.CHAT,
    val phase: SessionPhase = SessionPhase.IDLE,
    val duplexActivity: DuplexActivity = DuplexActivity.READY,
    val statusText: String = "准备就绪",
    val serviceAvailable: Boolean? = null,
    val messages: List<ConversationMessage> = emptyList(),
    val composerText: String = "",
    val settings: SessionSettings = SessionSettings(),
    val effectiveSession: EffectiveSessionConfiguration? = null,
    val settingsVisible: Boolean = false,
    val micEnabled: Boolean = true,
    val forceListen: Boolean = false,
    val audioLevel: Float = 0f,
    val cameraError: String? = null,
    val mediaError: String? = null,
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

fun AppUiState.withServerManagedSession(
    realtimeUrl: String,
    systemPrompt: String,
    model: String,
    promptVersion: Int?,
    memoryCount: Int?,
    routineCount: Int?,
): AppUiState = copy(
    effectiveSession = EffectiveSessionConfiguration(
        apiHost = realtimeUrl,
        systemPrompt = systemPrompt,
        model = model,
        promptVersion = promptVersion,
        lengthPenalty = settings.lengthPenalty,
        memoryCount = memoryCount,
        routineCount = routineCount,
    ),
)
