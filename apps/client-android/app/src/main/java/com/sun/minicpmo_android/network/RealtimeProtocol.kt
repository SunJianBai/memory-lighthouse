package com.sun.minicpmo_android.network

import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.model.SessionSettings
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

object RealtimeProtocol {
    fun webSocketUrl(apiHost: String, mode: RealtimeMode): String {
        val cleanHost = apiHost.trim().trimEnd('/')
        require(cleanHost.startsWith("https://") || cleanHost.startsWith("wss://")) {
            "API 地址必须使用 HTTPS 或 WSS"
        }
        val wsHost = when {
            cleanHost.startsWith("https://") -> "wss://${cleanHost.removePrefix("https://")}"
            else -> cleanHost
        }
        return if (wsHost.substringAfter("://").contains('/')) {
            "$wsHost${if (wsHost.contains('?')) '&' else '?'}mode=${mode.apiValue}"
        } else {
            "$wsHost/v1/realtime?mode=${mode.apiValue}"
        }
    }

    fun statusUrl(apiHost: String): String {
        val cleanHost = apiHost.trim().trimEnd('/')
        val httpEndpoint = if (cleanHost.startsWith("wss://")) {
            "https://${cleanHost.removePrefix("wss://")}"
        } else {
            cleanHost
        }
        require(httpEndpoint.startsWith("https://")) { "API 地址必须使用 HTTPS 或 WSS" }
        val origin = "https://${httpEndpoint.removePrefix("https://").substringBefore('/')}"
        return "$origin/status"
    }

    fun sessionInit(settings: SessionSettings): String = JSONObject()
        .put("type", "session.init")
        .put(
            "payload",
            JSONObject()
                .put("system_prompt", settings.systemPrompt.trim())
                .put(
                    "config",
                    JSONObject().put("length_penalty", settings.lengthPenalty.toDouble()),
                ),
        )
        .toString()

    fun chatInput(text: String, ttsEnabled: Boolean, lengthPenalty: Float): String {
        val message = JSONObject()
            .put("role", "user")
            .put("content", text)
        val input = JSONObject()
            .put("messages", JSONArray().put(message))
            .put("streaming", true)
            .put(
                "generation",
                JSONObject()
                    .put("max_new_tokens", 512)
                    .put("length_penalty", lengthPenalty.toDouble()),
            )
            .put("omni_mode", false)
            .put("tts", JSONObject().put("enabled", ttsEnabled))
            .put("use_tts_template", false)
            .put("enable_thinking", false)

        return JSONObject()
            .put("type", "input.append")
            .put("input", input)
            .toString()
    }

    fun duplexInput(
        audioBase64: String,
        frameBase64: String?,
        forceListen: Boolean,
    ): String {
        val input = JSONObject()
            .put("audio", audioBase64)
            .put("force_listen", forceListen)
        if (frameBase64 != null) {
            input.put("video_frames", JSONArray().put(frameBase64))
            input.put("max_slice_nums", 1)
        }
        return JSONObject()
            .put("type", "input.append")
            .put("input", input)
            .toString()
    }

    fun close(reason: String = "user_stop"): String = JSONObject()
        .put("type", "session.close")
        .put("reason", reason)
        .toString()

    fun encodeFloat32(samples: FloatArray): String {
        val buffer = ByteBuffer.allocate(samples.size * Float.SIZE_BYTES)
            .order(ByteOrder.LITTLE_ENDIAN)
        samples.forEach(buffer::putFloat)
        return Base64.getEncoder().encodeToString(buffer.array())
    }

    fun decodeFloat32(base64: String): FloatArray {
        val bytes = Base64.getDecoder().decode(base64)
        if (bytes.size < Float.SIZE_BYTES) return FloatArray(0)
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        return FloatArray(bytes.size / Float.SIZE_BYTES) { buffer.float }
    }
}
