package com.sun.minicpmo_android.network

import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.model.SessionSettings
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RealtimeApiClientLifecycleTest {
    @Test
    fun `terminal protocol event rejects later chat and closes the listener once`() {
        val socket = ControllableWebSocket()
        val client = RealtimeApiClient(
            httpClient = OkHttpClient(),
            webSocketFactory = WebSocket.Factory { request, listener ->
                socket.attach(request, listener)
                socket
            },
        )
        val listener = RecordingListener()

        client.connect(
            mode = RealtimeMode.CHAT,
            settings = SessionSettings(apiHost = "wss://realtime.test"),
            listener = listener,
        )
        socket.emitMessage(
            """{"type":"session.created","session_id":"session-1"}""",
        )

        assertTrue(client.isSessionReady)
        assertTrue(client.sendChat("会话仍在进行", ttsEnabled = false, lengthPenalty = 1f))

        socket.emitMessage(
            """{"type":"session.closed","reason":"timeout"}""",
        )

        assertFalse(client.isSessionReady)
        assertFalse(client.sendChat("这条消息不能再发送", ttsEnabled = false, lengthPenalty = 1f))

        socket.emitMessage(
            """{"type":"session.closed","reason":"timeout"}""",
        )
        socket.emitClosed("timeout")
        assertEquals(listOf("timeout"), listener.closedReasons)
    }
}

private class RecordingListener : RealtimeApiClient.Listener {
    val closedReasons = mutableListOf<String>()

    override fun onClosed(reason: String) {
        closedReasons += reason
    }
}

private class ControllableWebSocket : WebSocket {
    private lateinit var request: Request
    private lateinit var listener: WebSocketListener

    fun attach(request: Request, listener: WebSocketListener) {
        this.request = request
        this.listener = listener
    }

    fun emitMessage(text: String) {
        listener.onMessage(this, text)
    }

    fun emitClosed(reason: String) {
        listener.onClosed(this, 1000, reason)
    }

    override fun request(): Request = request

    override fun queueSize(): Long = 0L

    override fun send(text: String): Boolean = true

    override fun send(bytes: ByteString): Boolean = true

    override fun close(code: Int, reason: String?): Boolean = true

    override fun cancel() = Unit
}
