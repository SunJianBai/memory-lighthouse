package com.sun.minicpmo_android

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.sun.minicpmo_android.data.SettingsRepository
import com.sun.minicpmo_android.lighthouse.data.CompanionSessionBridge
import com.sun.minicpmo_android.lighthouse.model.CompanionModelConnection
import com.sun.minicpmo_android.media.DuplexAudioEngine
import com.sun.minicpmo_android.model.AppUiState
import com.sun.minicpmo_android.model.ConversationMessage
import com.sun.minicpmo_android.model.MessageRole
import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.model.SessionPhase
import com.sun.minicpmo_android.model.SessionSettings
import com.sun.minicpmo_android.network.RealtimeApiClient
import com.sun.minicpmo_android.network.RealtimeProtocol
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

class MainViewModel(
    private val settingsRepository: SettingsRepository,
    private val realtimeClient: RealtimeApiClient,
    private val audioEngine: DuplexAudioEngine,
    private val companionBridge: CompanionSessionBridge? = null,
) : ViewModel(), RealtimeApiClient.Listener {
    private val nextMessageId = AtomicLong(1)
    private val latestVideoFrame = AtomicReference<String?>(null)
    private var pendingChat: String? = null
    private var stoppedByUser = false
    private var companionConnection: CompanionModelConnection? = null
    private var firstResponseReported = false

    private val _uiState = MutableStateFlow(
        AppUiState(settings = settingsRepository.load()),
    )
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    init {
        refreshServiceStatus()
    }

    fun selectMode(mode: RealtimeMode) {
        if (mode == _uiState.value.selectedMode) return
        stopSession(quiet = true)
        _uiState.value = _uiState.value.copy(
            selectedMode = mode,
            phase = SessionPhase.IDLE,
            statusText = when (mode) {
                RealtimeMode.CHAT -> "输入消息开始对话"
                RealtimeMode.AUDIO -> "准备开始语音双工"
                RealtimeMode.VIDEO -> "准备开始视频双工"
            },
            messages = emptyList(),
            queuePosition = null,
            queueWaitSeconds = null,
            sessionId = null,
            forceListen = false,
            audioLevel = 0f,
        )
    }

    fun updateComposer(text: String) {
        _uiState.value = _uiState.value.copy(composerText = text)
    }

    fun sendChat() {
        val state = _uiState.value
        val text = state.composerText.trim()
        if (text.isEmpty() || state.selectedMode != RealtimeMode.CHAT) return

        addMessage(MessageRole.USER, text)
        _uiState.value = _uiState.value.copy(composerText = "")
        if (realtimeClient.isSessionReady) {
            if (!realtimeClient.sendChat(
                    text,
                    state.settings.chatTtsEnabled,
                    state.settings.lengthPenalty,
                )
            ) {
                reportError("消息发送失败，请重新连接")
            }
        } else {
            pendingChat = text
            connect(RealtimeMode.CHAT)
        }
    }

    fun startDuplex() {
        val mode = _uiState.value.selectedMode
        if (mode == RealtimeMode.CHAT || _uiState.value.hasActiveSession) return
        connect(mode)
    }

    fun stopSession(quiet: Boolean = false) {
        stoppedByUser = true
        pendingChat = null
        audioEngine.stop()
        realtimeClient.close("user_stop")
        latestVideoFrame.set(null)
        finishCompanion("DEVICE_ENDED")
        _uiState.value = _uiState.value.copy(
            phase = if (quiet) SessionPhase.IDLE else SessionPhase.STOPPED,
            statusText = if (quiet) "准备就绪" else "会话已结束",
            queuePosition = null,
            queueWaitSeconds = null,
            sessionId = null,
            audioLevel = 0f,
            forceListen = false,
        )
    }

    /** Stops local capture/provider and confirms the server model is closed. */
    fun stopForRemoteCall(
        onStopped: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        val connection = stopLocalCompanionForHandoff()
        if (connection == null) {
            onStopped()
            return
        }
        viewModelScope.launch {
            runCatching {
                withTimeout(2_500) {
                    requireNotNull(companionBridge) {
                        "Companion session bridge is unavailable"
                    }.end(connection, "REMOTE_CALL_ACCEPTED")
                }
            }.onSuccess {
                onStopped()
            }.onFailure(onFailure)
        }
    }

    /** A STOP heartbeat means the server session is already non-reusable. */
    fun stopForServerDirective(onStopped: () -> Unit) {
        val connection = stopLocalCompanionForHandoff()
        connection?.let { companionBridge?.acknowledgeServerStop(it) }
        onStopped()
    }

    private fun stopLocalCompanionForHandoff(): CompanionModelConnection? {
        stoppedByUser = true
        pendingChat = null
        val connection = companionConnection
        companionConnection = null
        audioEngine.stop()
        realtimeClient.close("remote_call")
        latestVideoFrame.set(null)
        _uiState.value = _uiState.value.copy(
            phase = SessionPhase.STOPPED,
            statusText = "正在切换到家属通话",
            queuePosition = null,
            queueWaitSeconds = null,
            sessionId = null,
            audioLevel = 0f,
            forceListen = false,
        )
        return connection
    }

    fun togglePause() {
        val state = _uiState.value
        when (state.phase) {
            SessionPhase.LIVE -> {
                audioEngine.clearPlayback()
                _uiState.value = state.copy(
                    phase = SessionPhase.PAUSED,
                    statusText = "会话已暂停",
                    audioLevel = 0f,
                )
            }

            SessionPhase.PAUSED -> _uiState.value = state.copy(
                phase = SessionPhase.LIVE,
                statusText = "会话进行中",
            )

            else -> Unit
        }
    }

    fun toggleMic() {
        _uiState.value = _uiState.value.copy(micEnabled = !_uiState.value.micEnabled)
    }

    fun toggleForceListen() {
        val active = !_uiState.value.forceListen
        if (active) audioEngine.clearPlayback()
        _uiState.value = _uiState.value.copy(
            forceListen = active,
            statusText = if (active) "强制聆听已开启" else "会话进行中",
        )
    }

    fun onVideoFrame(base64Jpeg: String) {
        latestVideoFrame.set(base64Jpeg)
    }

    fun onCameraError(message: String) {
        addSystemMessage("摄像头：$message")
    }

    fun setSettingsVisible(visible: Boolean) {
        _uiState.value = _uiState.value.copy(settingsVisible = visible)
    }

    fun updateSettings(settings: SessionSettings) {
        _uiState.value = _uiState.value.copy(settings = settings)
    }

    fun saveSettings(): String? {
        val settings = _uiState.value.settings.copy(
            apiHost = _uiState.value.settings.apiHost.trim().trimEnd('/'),
            systemPrompt = _uiState.value.settings.systemPrompt.trim(),
            lengthPenalty = _uiState.value.settings.lengthPenalty.coerceIn(0.1f, 3f),
        )
        val validationError = runCatching {
            require(settings.systemPrompt.isNotBlank()) { "系统提示词不能为空" }
            RealtimeProtocol.webSocketUrl(settings.apiHost, RealtimeMode.CHAT)
        }.exceptionOrNull()?.message
        if (validationError != null) return validationError

        if (_uiState.value.hasActiveSession) stopSession(quiet = true)
        settingsRepository.save(settings)
        _uiState.value = _uiState.value.copy(
            settings = settings,
            settingsVisible = false,
        )
        refreshServiceStatus()
        return null
    }

    fun clearConversation() {
        if (_uiState.value.hasActiveSession) stopSession(quiet = true)
        _uiState.value = _uiState.value.copy(
            messages = emptyList(),
            phase = SessionPhase.IDLE,
            statusText = "对话已清空",
        )
    }

    fun onAppBackgrounded() {
        if (_uiState.value.hasActiveSession) stopSession()
    }

    fun refreshServiceStatus() {
        val host = _uiState.value.settings.apiHost
        viewModelScope.launch {
            val available = realtimeClient.isServiceAvailable(host)
            _uiState.value = _uiState.value.copy(serviceAvailable = available)
        }
    }

    private fun connect(mode: RealtimeMode) {
        stoppedByUser = false
        _uiState.value = _uiState.value.copy(
            phase = SessionPhase.CONNECTING,
            statusText = "正在连接服务",
            queuePosition = null,
            queueWaitSeconds = null,
        )
        viewModelScope.launch {
            runCatching {
                val connection = companionBridge?.let { bridge ->
                    bridge.prepare(mode).also {
                        companionConnection = it
                        firstResponseReported = false
                        _uiState.value = _uiState.value.copy(
                            settings = _uiState.value.settings.copy(
                                apiHost = it.realtimeUrl,
                                systemPrompt = it.systemPrompt,
                            ),
                        )
                        bridge.event(it, "CONNECTING")
                    }
                }
                realtimeClient.connect(
                    mode,
                    connection?.let {
                        _uiState.value.settings.copy(
                            apiHost = it.realtimeUrl,
                            systemPrompt = it.systemPrompt,
                        )
                    } ?: _uiState.value.settings,
                    this@MainViewModel,
                )
            }.onFailure { reportError(it.message ?: "连接参数无效") }
        }
    }

    override fun onSocketOpen() {
        _uiState.value = _uiState.value.copy(statusText = "已连接，等待服务分配")
    }

    override fun onQueue(position: Int?, estimatedWaitSeconds: Int?) {
        reportCompanionEvent("QUEUED")
        _uiState.value = _uiState.value.copy(
            phase = SessionPhase.QUEUED,
            statusText = buildString {
                append("正在排队")
                position?.let { append(" · 前方 $it 位") }
                estimatedWaitSeconds?.let { append(" · 约 ${it}s") }
            },
            queuePosition = position,
            queueWaitSeconds = estimatedWaitSeconds,
        )
    }

    override fun onQueueDone() {
        _uiState.value = _uiState.value.copy(
            phase = SessionPhase.PREPARING,
            statusText = "Worker 已分配，正在初始化",
            queuePosition = null,
            queueWaitSeconds = null,
        )
    }

    override fun onSessionCreated(sessionId: String) {
        reportCompanionEvent("CONNECTED")
        _uiState.value = _uiState.value.copy(
            phase = SessionPhase.LIVE,
            statusText = if (_uiState.value.selectedMode == RealtimeMode.CHAT) {
                "模型已就绪"
            } else {
                "会话进行中"
            },
            sessionId = sessionId,
        )

        if (_uiState.value.selectedMode == RealtimeMode.CHAT) {
            if (_uiState.value.settings.chatTtsEnabled) {
                runCatching { audioEngine.startPlayback() }
                    .onFailure { addSystemMessage("音频播放不可用：${it.message}") }
            }
            pendingChat?.let { text ->
                pendingChat = null
                if (!realtimeClient.sendChat(
                        text,
                        _uiState.value.settings.chatTtsEnabled,
                        _uiState.value.settings.lengthPenalty,
                    )
                ) {
                    reportError("消息发送失败，请重试")
                }
            }
        } else {
            startDuplexMedia()
        }
    }

    override fun onListen(metrics: JSONObject?) {
        finalizeStreamingMessage()
        updateMetrics(metrics)
        if (_uiState.value.phase == SessionPhase.LIVE) {
            _uiState.value = _uiState.value.copy(statusText = "正在聆听")
        }
    }

    override fun onTextDelta(text: String, responseId: String?) {
        if (text.isBlank()) return
        if (!firstResponseReported) {
            firstResponseReported = true
            reportCompanionEvent("FIRST_RESPONSE")
        }
        val messages = _uiState.value.messages.toMutableList()
        val lastIndex = messages.indexOfLast {
            it.role == MessageRole.ASSISTANT && it.streaming &&
                (responseId == null || it.responseId == null || it.responseId == responseId)
        }
        if (lastIndex >= 0) {
            val previous = messages[lastIndex]
            messages[lastIndex] = previous.copy(
                text = previous.text + text,
                responseId = responseId ?: previous.responseId,
            )
        } else {
            messages += ConversationMessage(
                id = nextMessageId.getAndIncrement(),
                role = MessageRole.ASSISTANT,
                text = text,
                responseId = responseId,
                streaming = true,
            )
        }
        _uiState.value = _uiState.value.copy(
            messages = messages,
            statusText = "MiniCPM-o 正在回答",
        )
    }

    override fun onAudioDelta(audioBase64: String) {
        runCatching { audioEngine.enqueuePlayback(audioBase64) }
            .onFailure { addSystemMessage("音频解码失败：${it.message}") }
    }

    override fun onResponseDone(text: String, responseId: String?) {
        val messages = _uiState.value.messages.toMutableList()
        val index = messages.indexOfLast {
            it.role == MessageRole.ASSISTANT &&
                (responseId == null || it.responseId == responseId)
        }
        if (index >= 0) {
            val current = messages[index]
            messages[index] = current.copy(
                text = text.ifBlank { current.text },
                streaming = false,
            )
        } else if (text.isNotBlank()) {
            messages += ConversationMessage(
                id = nextMessageId.getAndIncrement(),
                role = MessageRole.ASSISTANT,
                text = text,
                responseId = responseId,
            )
        }
        _uiState.value = _uiState.value.copy(
            messages = messages,
            statusText = "模型已就绪",
        )
        val connection = companionConnection
        if (connection != null && text.isNotBlank()) {
            viewModelScope.launch {
                runCatching {
                    companionBridge?.assistantUtterance(
                        connection,
                        responseId ?: "response-${System.nanoTime()}",
                        text,
                    )
                }
            }
        }
    }

    override fun onMetrics(metrics: JSONObject) {
        updateMetrics(metrics)
    }

    override fun onClosed(reason: String) {
        audioEngine.stop()
        if (stoppedByUser) return
        reportCompanionEvent("DISCONNECTED")
        finishCompanion(if (reason == "timeout") "PROVIDER_TIMEOUT" else "PROVIDER_DISCONNECTED")
        finalizeStreamingMessage()
        _uiState.value = _uiState.value.copy(
            phase = SessionPhase.STOPPED,
            statusText = when (reason) {
                "timeout" -> "会话已达到时长上限"
                else -> "会话已结束：$reason"
            },
            audioLevel = 0f,
            sessionId = null,
        )
    }

    override fun onError(message: String) {
        if (!stoppedByUser) {
            reportCompanionEvent("PROVIDER_ERROR", errorCode = "PROVIDER_CONNECTION_ERROR")
            reportError(message)
        }
    }

    private fun startDuplexMedia() {
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                audioEngine.startPlayback()
                audioEngine.startRecording { samples, level ->
                    val state = _uiState.value
                    if (state.phase != SessionPhase.LIVE) return@startRecording
                    _uiState.value = state.copy(audioLevel = level)
                    val outgoing = if (state.micEnabled) samples else FloatArray(samples.size)
                    val frame = if (state.selectedMode == RealtimeMode.VIDEO) {
                        latestVideoFrame.getAndSet(null)
                    } else {
                        null
                    }
                    realtimeClient.sendDuplex(outgoing, frame, state.forceListen)
                }
            }.onFailure { reportError("音频设备启动失败：${it.message}") }
        }
    }

    private fun addMessage(role: MessageRole, text: String) {
        _uiState.value = _uiState.value.copy(
            messages = _uiState.value.messages + ConversationMessage(
                id = nextMessageId.getAndIncrement(),
                role = role,
                text = text,
            ),
        )
    }

    private fun addSystemMessage(text: String) {
        addMessage(MessageRole.SYSTEM, text)
    }

    private fun finalizeStreamingMessage() {
        _uiState.value = _uiState.value.copy(
            messages = _uiState.value.messages.map {
                if (it.streaming) it.copy(streaming = false) else it
            },
        )
    }

    private fun reportError(message: String) {
        audioEngine.stop()
        realtimeClient.close("client_error")
        finishCompanion("CLIENT_ERROR")
        _uiState.value = _uiState.value.copy(
            phase = SessionPhase.ERROR,
            statusText = message,
            audioLevel = 0f,
            sessionId = null,
        )
        addSystemMessage(message)
    }

    private fun updateMetrics(metrics: JSONObject?) {
        if (metrics == null) return
        val latency = when {
            metrics.has("latency_ms") -> metrics.optLong("latency_ms")
            metrics.has("wall_clock_ms") -> metrics.optLong("wall_clock_ms")
            else -> null
        }
        val kv = if (metrics.has("kv_cache_length")) {
            metrics.optInt("kv_cache_length")
        } else {
            null
        }
        _uiState.value = _uiState.value.copy(
            lastLatencyMs = latency ?: _uiState.value.lastLatencyMs,
            lastKvCacheLength = kv ?: _uiState.value.lastKvCacheLength,
        )
    }

    private fun reportCompanionEvent(
        type: String,
        metrics: Map<String, Number>? = null,
        errorCode: String? = null,
    ) {
        val connection = companionConnection ?: return
        viewModelScope.launch {
            runCatching { companionBridge?.event(connection, type, metrics, errorCode) }
        }
    }

    private fun finishCompanion(reason: String) {
        val connection = companionConnection ?: return
        companionConnection = null
        viewModelScope.launch {
            runCatching { companionBridge?.end(connection, reason) }
        }
    }

    override fun onCleared() {
        audioEngine.stop()
        realtimeClient.close("client_closed")
        super.onCleared()
    }

    companion object {
        fun factory(
            context: Context,
            companionBridge: CompanionSessionBridge? = null,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return MainViewModel(
                        settingsRepository = SettingsRepository(context),
                        realtimeClient = RealtimeApiClient(),
                        audioEngine = DuplexAudioEngine(context),
                        companionBridge = companionBridge,
                    ) as T
                }
            }
    }
}
