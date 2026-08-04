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
import com.sun.minicpmo_android.model.DuplexActivity
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
import kotlinx.coroutines.flow.update
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
    private val mediaGeneration = AtomicLong(0)
    private val connectionGeneration = AtomicLong(0)
    private val mediaStateLock = Any()
    private var pendingChat: String? = null
    @Volatile
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
        _uiState.update { current ->
            current.copy(
                selectedMode = mode,
                phase = SessionPhase.IDLE,
                duplexActivity = DuplexActivity.READY,
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
                cameraError = null,
                mediaError = null,
            )
        }
    }

    fun updateComposer(text: String) {
        _uiState.update { current -> current.copy(composerText = text) }
    }

    fun sendChat() {
        val state = _uiState.value
        val text = state.composerText.trim()
        if (text.isEmpty() || state.selectedMode != RealtimeMode.CHAT) return

        addMessage(MessageRole.USER, text)
        _uiState.update { current -> current.copy(composerText = "") }
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
        pendingChat = null
        synchronized(mediaStateLock) {
            stoppedByUser = true
            mediaGeneration.incrementAndGet()
            connectionGeneration.incrementAndGet()
            _uiState.update { current ->
                current.copy(
                    phase = if (quiet) SessionPhase.IDLE else SessionPhase.STOPPED,
                    duplexActivity = DuplexActivity.READY,
                    statusText = if (quiet) "准备就绪" else "会话已结束",
                    queuePosition = null,
                    queueWaitSeconds = null,
                    sessionId = null,
                    audioLevel = 0f,
                    forceListen = false,
                    mediaError = null,
                )
            }
        }
        latestVideoFrame.set(null)
        audioEngine.stop()
        realtimeClient.close("user_stop")
        finishCompanion("DEVICE_ENDED")
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
        pendingChat = null
        val connection = companionConnection
        companionConnection = null
        synchronized(mediaStateLock) {
            stoppedByUser = true
            mediaGeneration.incrementAndGet()
            connectionGeneration.incrementAndGet()
            _uiState.update { current ->
                current.copy(
                    phase = SessionPhase.STOPPED,
                    duplexActivity = DuplexActivity.READY,
                    statusText = "正在切换到家属通话",
                    queuePosition = null,
                    queueWaitSeconds = null,
                    sessionId = null,
                    audioLevel = 0f,
                    forceListen = false,
                )
            }
        }
        latestVideoFrame.set(null)
        audioEngine.stop()
        realtimeClient.close("remote_call")
        return connection
    }

    fun togglePause() {
        var stopCapture = false
        var startCapture = false
        synchronized(mediaStateLock) {
            val state = _uiState.value
            when (state.phase) {
                SessionPhase.LIVE -> {
                    mediaGeneration.incrementAndGet()
                    _uiState.value = state.copy(
                        phase = SessionPhase.PAUSED,
                        duplexActivity = DuplexActivity.READY,
                        statusText = "已暂停传输，麦克风和摄像头已停止",
                        audioLevel = 0f,
                    )
                    stopCapture = true
                }

                SessionPhase.PAUSED -> {
                    _uiState.value = state.copy(
                        phase = SessionPhase.LIVE,
                        duplexActivity = DuplexActivity.LISTENING,
                        statusText = if (state.micEnabled) {
                            "正在聆听"
                        } else {
                            "麦克风已静音，不发送声音"
                        },
                        audioLevel = 0f,
                    )
                    startCapture = true
                }

                else -> Unit
            }
        }
        if (stopCapture) {
            latestVideoFrame.set(null)
            audioEngine.stop()
        } else if (startCapture) {
            startDuplexMedia()
        }
    }

    fun toggleMic() {
        synchronized(mediaStateLock) {
            val state = _uiState.value
            val enabled = !state.micEnabled
            _uiState.value = state.copy(
                micEnabled = enabled,
                audioLevel = if (enabled) state.audioLevel else 0f,
                statusText = when {
                    !enabled -> "麦克风已静音，不发送声音"
                    state.phase == SessionPhase.PAUSED -> "会话已暂停"
                    state.duplexActivity == DuplexActivity.RESPONDING -> "MiniCPM-o 正在回答"
                    else -> "正在聆听"
                },
            )
        }
    }

    fun toggleForceListen() {
        synchronized(mediaStateLock) {
            val state = _uiState.value
            val active = !state.forceListen
            if (active) audioEngine.clearPlayback()
            _uiState.value = state.copy(
                forceListen = active,
                duplexActivity = if (state.phase == SessionPhase.LIVE) {
                    DuplexActivity.LISTENING
                } else {
                    state.duplexActivity
                },
                statusText = when {
                    state.phase == SessionPhase.PAUSED -> "会话已暂停"
                    !state.micEnabled -> "麦克风已静音，不发送声音"
                    active -> "强制聆听已开启"
                    else -> "正在聆听"
                },
            )
        }
    }

    fun onVideoFrame(base64Jpeg: String) {
        if (base64Jpeg.isBlank()) return
        synchronized(mediaStateLock) {
            if (_uiState.value.phase != SessionPhase.LIVE) return
            latestVideoFrame.set(base64Jpeg)
            _uiState.update { current ->
                if (current.cameraError == null) current else current.copy(cameraError = null)
            }
        }
    }

    fun onCameraError(message: String) {
        val cameraError = message.trim().ifEmpty { "摄像头不可用" }
        val isNew = _uiState.value.cameraError != cameraError
        _uiState.update { current -> current.copy(cameraError = cameraError) }
        if (isNew) {
            addSystemMessage("摄像头：$cameraError")
        }
    }

    fun setSettingsVisible(visible: Boolean) {
        _uiState.update { current -> current.copy(settingsVisible = visible) }
    }

    fun updateSettings(settings: SessionSettings) {
        _uiState.update { current -> current.copy(settings = settings) }
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
        _uiState.update { current ->
            current.copy(settings = settings, settingsVisible = false)
        }
        refreshServiceStatus()
        return null
    }

    fun clearConversation() {
        if (_uiState.value.hasActiveSession) stopSession(quiet = true)
        _uiState.update { current ->
            current.copy(
                messages = emptyList(),
                phase = SessionPhase.IDLE,
                duplexActivity = DuplexActivity.READY,
                statusText = "对话已清空",
            )
        }
    }

    fun onAppBackgrounded() {
        if (_uiState.value.hasActiveSession) stopSession()
    }

    fun refreshServiceStatus() {
        val host = _uiState.value.settings.apiHost
        viewModelScope.launch {
            val available = realtimeClient.isServiceAvailable(host)
            _uiState.update { current -> current.copy(serviceAvailable = available) }
        }
    }

    private fun connect(mode: RealtimeMode) {
        latestVideoFrame.set(null)
        val attemptGeneration = synchronized(mediaStateLock) {
            stoppedByUser = false
            companionConnection = null
            mediaGeneration.incrementAndGet()
            val generation = connectionGeneration.incrementAndGet()
            _uiState.update { current ->
                current.copy(
                    phase = SessionPhase.CONNECTING,
                    duplexActivity = DuplexActivity.READY,
                    statusText = "正在连接服务",
                    cameraError = null,
                    mediaError = null,
                    forceListen = false,
                    audioLevel = 0f,
                    queuePosition = null,
                    queueWaitSeconds = null,
                )
            }
            generation
        }
        audioEngine.stop()
        viewModelScope.launch {
            runCatching {
                val bridge = companionBridge
                val connection = bridge?.prepare(mode)
                val accepted = synchronized(mediaStateLock) {
                    if (!isConnectionAttemptCurrent(attemptGeneration)) {
                        false
                    } else {
                        companionConnection = connection
                        firstResponseReported = false
                        connection?.let { prepared ->
                            _uiState.update { current ->
                                current.copy(
                                    settings = current.settings.copy(
                                        apiHost = prepared.realtimeUrl,
                                        systemPrompt = prepared.systemPrompt,
                                    ),
                                )
                            }
                        }
                        true
                    }
                }
                if (!accepted) {
                    if (bridge != null && connection != null) {
                        runCatching { bridge.end(connection, "DEVICE_ENDED") }
                    }
                    return@runCatching
                }
                if (bridge != null && connection != null) {
                    bridge.event(connection, "CONNECTING")
                }
                val connected = synchronized(mediaStateLock) {
                    if (!isConnectionAttemptCurrent(attemptGeneration)) {
                        false
                    } else {
                        val currentSettings = _uiState.value.settings
                        realtimeClient.connect(
                            mode,
                            connection?.let {
                                currentSettings.copy(
                                    apiHost = it.realtimeUrl,
                                    systemPrompt = it.systemPrompt,
                                )
                            } ?: currentSettings,
                            this@MainViewModel,
                        )
                        true
                    }
                }
                if (!connected) {
                    if (bridge != null && connection != null) {
                        runCatching { bridge.end(connection, "DEVICE_ENDED") }
                    }
                    return@runCatching
                }
            }.onFailure {
                if (isConnectionAttemptCurrent(attemptGeneration)) {
                    reportError(it.message ?: "连接参数无效")
                }
            }
        }
    }

    private fun isConnectionAttemptCurrent(generation: Long): Boolean =
        connectionGeneration.get() == generation &&
            !stoppedByUser &&
            _uiState.value.phase == SessionPhase.CONNECTING

    override fun onSocketOpen() {
        if (stoppedByUser) return
        _uiState.update { current ->
            current.copy(
                duplexActivity = DuplexActivity.READY,
                statusText = "已连接，等待服务分配",
            )
        }
    }

    override fun onQueue(position: Int?, estimatedWaitSeconds: Int?) {
        reportCompanionEvent("QUEUED")
        if (stoppedByUser) return
        _uiState.update { current ->
            current.copy(
                phase = SessionPhase.QUEUED,
                duplexActivity = DuplexActivity.READY,
                statusText = buildString {
                    append("正在排队")
                    position?.let { append(" · 前方 $it 位") }
                    estimatedWaitSeconds?.let { append(" · 约 ${it}s") }
                },
                queuePosition = position,
                queueWaitSeconds = estimatedWaitSeconds,
            )
        }
    }

    override fun onQueueDone() {
        if (stoppedByUser) return
        _uiState.update { current ->
            current.copy(
                phase = SessionPhase.PREPARING,
                duplexActivity = DuplexActivity.READY,
                statusText = "Worker 已分配，正在初始化",
                queuePosition = null,
                queueWaitSeconds = null,
            )
        }
    }

    override fun onSessionCreated(sessionId: String) {
        val selectedMode = synchronized(mediaStateLock) {
            val current = _uiState.value
            if (
                stoppedByUser ||
                current.phase !in setOf(
                    SessionPhase.CONNECTING,
                    SessionPhase.QUEUED,
                    SessionPhase.PREPARING,
                )
            ) {
                return
            }
            val mode = current.selectedMode
            _uiState.update { latest ->
                latest.copy(
                    phase = SessionPhase.LIVE,
                    duplexActivity = if (mode == RealtimeMode.CHAT) {
                        DuplexActivity.READY
                    } else {
                        DuplexActivity.LISTENING
                    },
                    statusText = if (mode == RealtimeMode.CHAT) {
                        "模型已就绪"
                    } else if (!latest.micEnabled) {
                        "麦克风已静音，不发送声音"
                    } else {
                        "正在聆听"
                    },
                    sessionId = sessionId,
                    mediaError = null,
                )
            }
            mode
        }
        reportCompanionEvent("CONNECTED")

        if (selectedMode == RealtimeMode.CHAT) {
            if (_uiState.value.settings.chatTtsEnabled) {
                runCatching {
                    synchronized(mediaStateLock) {
                        if (!stoppedByUser && _uiState.value.phase == SessionPhase.LIVE) {
                            audioEngine.startPlayback()
                        }
                    }
                }
                    .onFailure { reportMediaError("音频播放不可用：${it.message}") }
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
        _uiState.update { current ->
            if (current.phase != SessionPhase.LIVE) {
                current
            } else {
                current.copy(
                    duplexActivity = DuplexActivity.LISTENING,
                    statusText = if (current.micEnabled) {
                        "正在聆听"
                    } else {
                        "麦克风已静音，不发送声音"
                    },
                )
            }
        }
    }

    override fun onTextDelta(text: String, responseId: String?) {
        if (text.isBlank()) return
        if (!firstResponseReported) {
            firstResponseReported = true
            reportCompanionEvent("FIRST_RESPONSE")
        }
        val newMessageId = nextMessageId.getAndIncrement()
        _uiState.update { current ->
            val messages = current.messages.toMutableList()
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
                    id = newMessageId,
                    role = MessageRole.ASSISTANT,
                    text = text,
                    responseId = responseId,
                    streaming = true,
                )
            }
            current.copy(
                messages = messages,
                duplexActivity = if (current.phase == SessionPhase.LIVE) {
                    DuplexActivity.RESPONDING
                } else {
                    current.duplexActivity
                },
                statusText = if (current.phase == SessionPhase.LIVE) {
                    "MiniCPM-o 正在回答"
                } else {
                    current.statusText
                },
            )
        }
    }

    override fun onAudioDelta(audioBase64: String) {
        if (audioBase64.isBlank()) return
        synchronized(mediaStateLock) {
            if (_uiState.value.phase != SessionPhase.LIVE) return
            runCatching { audioEngine.enqueuePlayback(audioBase64) }
                .onSuccess {
                    _uiState.update { current ->
                        if (
                            current.phase == SessionPhase.LIVE &&
                            current.duplexActivity != DuplexActivity.RESPONDING
                        ) {
                            current.copy(
                                duplexActivity = DuplexActivity.RESPONDING,
                                statusText = "MiniCPM-o 正在回答",
                            )
                        } else {
                            current
                        }
                    }
                }
                .onFailure { reportMediaError("音频解码失败：${it.message}") }
        }
    }

    override fun onResponseDone(text: String, responseId: String?) {
        val newMessageId = nextMessageId.getAndIncrement()
        _uiState.update { current ->
            val messages = current.messages.toMutableList()
            val index = messages.indexOfLast {
                it.role == MessageRole.ASSISTANT &&
                    (responseId == null || it.responseId == responseId)
            }
            if (index >= 0) {
                val previous = messages[index]
                messages[index] = previous.copy(
                    text = text.ifBlank { previous.text },
                    streaming = false,
                )
            } else if (text.isNotBlank()) {
                messages += ConversationMessage(
                    id = newMessageId,
                    role = MessageRole.ASSISTANT,
                    text = text,
                    responseId = responseId,
                )
            }
            val liveActivity = if (current.selectedMode == RealtimeMode.CHAT) {
                DuplexActivity.READY
            } else {
                DuplexActivity.LISTENING
            }
            current.copy(
                messages = messages,
                duplexActivity = if (current.phase == SessionPhase.LIVE) {
                    liveActivity
                } else {
                    current.duplexActivity
                },
                statusText = if (current.phase != SessionPhase.LIVE) {
                    current.statusText
                } else if (current.selectedMode == RealtimeMode.CHAT) {
                    "模型已就绪"
                } else if (!current.micEnabled) {
                    "麦克风已静音，不发送声音"
                } else {
                    "正在聆听"
                },
            )
        }
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
        if (stoppedByUser) return
        val closureMessage = when (reason) {
            "timeout" -> "会话已达到时长上限"
            else -> "会话已结束：$reason"
        }
        synchronized(mediaStateLock) {
            mediaGeneration.incrementAndGet()
            connectionGeneration.incrementAndGet()
            _uiState.update { current ->
                current.copy(
                    phase = SessionPhase.STOPPED,
                    duplexActivity = DuplexActivity.READY,
                    statusText = closureMessage,
                    mediaError = closureMessage,
                    messages = current.messages.map {
                        if (it.streaming) it.copy(streaming = false) else it
                    },
                    audioLevel = 0f,
                    forceListen = false,
                    queuePosition = null,
                    queueWaitSeconds = null,
                    sessionId = null,
                )
            }
        }
        latestVideoFrame.set(null)
        audioEngine.stop()
        reportCompanionEvent("DISCONNECTED")
        finishCompanion(if (reason == "timeout") "PROVIDER_TIMEOUT" else "PROVIDER_DISCONNECTED")
    }

    override fun onError(message: String) {
        if (!stoppedByUser) {
            reportCompanionEvent("PROVIDER_ERROR", errorCode = "PROVIDER_CONNECTION_ERROR")
            reportError(message)
        }
    }

    private fun startDuplexMedia() {
        val generation = mediaGeneration.incrementAndGet()
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                synchronized(mediaStateLock) {
                    if (
                        mediaGeneration.get() != generation ||
                        _uiState.value.phase != SessionPhase.LIVE
                    ) {
                        return@synchronized
                    }
                    audioEngine.startPlayback()
                    audioEngine.startRecording { samples, level ->
                        synchronized(mediaStateLock) {
                            val state = _uiState.value
                            if (
                                mediaGeneration.get() != generation ||
                                state.phase != SessionPhase.LIVE
                            ) {
                                return@synchronized
                            }
                            _uiState.update { current ->
                                if (
                                    mediaGeneration.get() == generation &&
                                    current.phase == SessionPhase.LIVE
                                ) {
                                    current.copy(
                                        audioLevel = if (current.micEnabled) level else 0f,
                                    )
                                } else {
                                    current
                                }
                            }
                            val outgoing = if (state.micEnabled) {
                                samples
                            } else {
                                FloatArray(samples.size)
                            }
                            val frame = if (state.selectedMode == RealtimeMode.VIDEO) {
                                latestVideoFrame.getAndSet(null)
                            } else {
                                null
                            }
                            realtimeClient.sendDuplex(outgoing, frame, state.forceListen)
                        }
                    }
                }
            }.onFailure {
                if (
                    mediaGeneration.get() == generation &&
                    _uiState.value.phase == SessionPhase.LIVE
                ) {
                    reportError("音频设备启动失败：${it.message}")
                }
            }
        }
    }

    private fun addMessage(role: MessageRole, text: String) {
        val message = ConversationMessage(
            id = nextMessageId.getAndIncrement(),
            role = role,
            text = text,
        )
        _uiState.update { current ->
            current.copy(messages = current.messages + message)
        }
    }

    private fun addSystemMessage(text: String) {
        addMessage(MessageRole.SYSTEM, text)
    }

    private fun reportMediaError(message: String) {
        val normalized = message.trim().ifEmpty { "陪伴服务暂时不可用" }
        val isNew = _uiState.value.mediaError != normalized
        _uiState.update { current -> current.copy(mediaError = normalized) }
        if (isNew) {
            addSystemMessage(normalized)
        }
    }

    private fun finalizeStreamingMessage() {
        _uiState.update { current ->
            current.copy(messages = current.messages.map {
                if (it.streaming) it.copy(streaming = false) else it
            })
        }
    }

    private fun reportError(message: String) {
        synchronized(mediaStateLock) {
            mediaGeneration.incrementAndGet()
            connectionGeneration.incrementAndGet()
            _uiState.update { current ->
                current.copy(
                    phase = SessionPhase.ERROR,
                    duplexActivity = DuplexActivity.READY,
                    statusText = message,
                    mediaError = message,
                    audioLevel = 0f,
                    forceListen = false,
                    queuePosition = null,
                    queueWaitSeconds = null,
                    sessionId = null,
                )
            }
        }
        latestVideoFrame.set(null)
        audioEngine.stop()
        realtimeClient.close("client_error")
        finishCompanion("CLIENT_ERROR")
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
        _uiState.update { current ->
            current.copy(
                lastLatencyMs = latency ?: current.lastLatencyMs,
                lastKvCacheLength = kv ?: current.lastKvCacheLength,
            )
        }
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
