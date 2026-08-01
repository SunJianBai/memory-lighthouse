package com.sun.minicpmo_android

import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.network.RealtimeProtocol
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RealtimeProtocolTest {
    @Test
    fun acceptsServerProvidedRealtimeEndpointWithoutDuplicatingPath() {
        assertEquals(
            "wss://minicpmo45.modelbest.cn/v1/realtime?mode=audio",
            RealtimeProtocol.webSocketUrl(
                "wss://minicpmo45.modelbest.cn/v1/realtime",
                RealtimeMode.AUDIO,
            ),
        )
    }
    @Test
    fun buildsSecureRealtimeUrlsForEveryMode() {
        assertEquals(
            "wss://minicpmo45.modelbest.cn/v1/realtime?mode=chat",
            RealtimeProtocol.webSocketUrl(
                "https://minicpmo45.modelbest.cn/",
                RealtimeMode.CHAT,
            ),
        )
        assertEquals(
            "wss://gateway.example.com/v1/realtime?mode=audio",
            RealtimeProtocol.webSocketUrl("wss://gateway.example.com", RealtimeMode.AUDIO),
        )
    }

    @Test
    fun rejectsInsecureApiHosts() {
        val result = runCatching {
            RealtimeProtocol.webSocketUrl("http://example.com", RealtimeMode.VIDEO)
        }
        assertTrue(result.isFailure)
    }

    @Test
    fun float32PcmRoundTripsWithoutPrecisionLoss() {
        val source = floatArrayOf(-1f, -0.25f, 0f, 0.25f, 0.999f)
        val encoded = RealtimeProtocol.encodeFloat32(source)
        val decoded = RealtimeProtocol.decodeFloat32(encoded)
        assertArrayEquals(source, decoded, 0f)
    }
}
