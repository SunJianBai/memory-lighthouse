package com.sun.minicpmo_android.network

import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.model.SessionSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class RealtimeApiClient(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build(),
) {
    interface Listener {
        fun onSocketOpen() = Unit
        fun onQueue(position: Int?, estimatedWaitSeconds: Int?) = Unit
        fun onQueueDone() = Unit
        fun onSessionCreated(sessionId: String) = Unit
        fun onListen(metrics: JSONObject?) = Unit
        fun onTextDelta(text: String, responseId: String?) = Unit
        fun onAudioDelta(audioBase64: String) = Unit
        fun onResponseDone(text: String, responseId: String?) = Unit
        fun onMetrics(metrics: JSONObject) = Unit
        fun onClosed(reason: String) = Unit
        fun onError(message: String) = Unit
    }

    private val lock = Any()
    private var socket: WebSocket? = null
    private var listener: Listener? = null
    private var settings: SessionSettings? = null
    private var initSent = false

    @Volatile
    var isSessionReady: Boolean = false
        private set

    fun connect(mode: RealtimeMode, settings: SessionSettings, listener: Listener) {
        close("reconnect")
        this.listener = listener
        this.settings = settings
        initSent = false
        isSessionReady = false

        val request = Request.Builder()
            .url(RealtimeProtocol.webSocketUrl(settings.apiHost, mode))
            .build()
        val newSocket = httpClient.newWebSocket(request, socketListener)
        synchronized(lock) { socket = newSocket }
    }

    fun sendChat(text: String, ttsEnabled: Boolean, lengthPenalty: Float): Boolean = send(
        RealtimeProtocol.chatInput(text, ttsEnabled, lengthPenalty),
    )

    fun sendDuplex(
        samples: FloatArray,
        frameBase64: String?,
        forceListen: Boolean,
    ): Boolean = send(
        RealtimeProtocol.duplexInput(
            audioBase64 = RealtimeProtocol.encodeFloat32(samples),
            frameBase64 = frameBase64,
            forceListen = forceListen,
        ),
    )

    fun close(reason: String = "user_stop") {
        val closing = synchronized(lock) {
            val existing = socket
            socket = null
            existing
        }
        if (closing != null) {
            closing.send(RealtimeProtocol.close(reason))
            closing.close(1000, reason.take(120))
        }
        initSent = false
        isSessionReady = false
    }

    suspend fun isServiceAvailable(apiHost: String): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder().url(RealtimeProtocol.statusUrl(apiHost)).build()
            httpClient.newCall(request).execute().use { it.isSuccessful }
        }.getOrDefault(false)
    }

    private fun send(text: String): Boolean = synchronized(lock) {
        socket?.send(text) ?: false
    }

    private fun sendSessionInit() {
        val currentSettings = settings ?: return
        synchronized(lock) {
            if (initSent) return
            initSent = true
            socket?.send(RealtimeProtocol.sessionInit(currentSettings))
        }
    }

    private val socketListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!isCurrent(webSocket)) return
            listener?.onSocketOpen()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!isCurrent(webSocket)) return
            runCatching { JSONObject(text) }
                .onSuccess(::handleEvent)
                .onFailure { listener?.onError("服务端消息无法解析：${it.message}") }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!isCurrent(webSocket)) return
            synchronized(lock) {
                if (socket === webSocket) socket = null
            }
            isSessionReady = false
            listener?.onClosed(reason.ifBlank { "连接已关闭" })
        }

        override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
            if (!isCurrent(webSocket)) return
            synchronized(lock) {
                if (socket === webSocket) socket = null
            }
            isSessionReady = false
            val suffix = response?.let { "（HTTP ${it.code}）" }.orEmpty()
            listener?.onError("连接失败$suffix：${throwable.message ?: "网络不可用"}")
        }
    }

    private fun handleEvent(event: JSONObject) {
        when (event.optString("type")) {
            "session.queued", "queued", "session.queue_update", "queue_update" -> {
                listener?.onQueue(
                    position = event.optIntOrNull("position"),
                    estimatedWaitSeconds = event.optDoubleOrNull("estimated_wait_s")?.toInt(),
                )
            }

            "session.queue_done", "queue_done" -> {
                listener?.onQueueDone()
                sendSessionInit()
            }

            "session.created" -> {
                isSessionReady = true
                listener?.onSessionCreated(event.optString("session_id"))
            }

            "response.output.delta" -> when (event.optString("kind")) {
                "listen" -> listener?.onListen(event.optJSONObject("metrics"))
                "text" -> listener?.onTextDelta(
                    event.optString("text"),
                    event.optStringOrNull("response_id"),
                )
                "audio" -> event.optStringOrNull("audio")?.let {
                    listener?.onAudioDelta(it)
                }
            }

            "response.listen" -> listener?.onListen(event.optJSONObject("metrics"))
            "response.output_audio.delta" -> {
                event.optStringOrNull("text")?.let {
                    listener?.onTextDelta(it, event.optStringOrNull("response_id"))
                }
                event.optStringOrNull("audio")?.let { listener?.onAudioDelta(it) }
            }

            "response.done" -> listener?.onResponseDone(
                event.optString("text"),
                event.optStringOrNull("response_id"),
            )

            "response.metrics" -> listener?.onMetrics(event)
            "session.closed", "stopped", "timeout" -> listener?.onClosed(
                event.optString("reason", "会话已结束"),
            )

            "error" -> {
                val error = event.optJSONObject("error")
                listener?.onError(
                    error?.optString("message")?.takeIf(String::isNotBlank)
                        ?: event.optString("error", "服务端返回未知错误"),
                )
            }
        }
    }

    private fun isCurrent(candidate: WebSocket): Boolean = synchronized(lock) {
        socket === candidate
    }
}

private fun JSONObject.optStringOrNull(key: String): String? =
    optString(key).takeIf { it.isNotBlank() }

private fun JSONObject.optIntOrNull(key: String): Int? =
    if (has(key) && !isNull(key)) optInt(key) else null

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (has(key) && !isNull(key)) optDouble(key) else null
