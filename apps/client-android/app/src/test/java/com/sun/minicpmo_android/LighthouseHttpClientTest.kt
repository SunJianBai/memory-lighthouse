package com.sun.minicpmo_android

import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.network.LighthouseHttpClient
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class LighthouseHttpClientTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun unwrapsEnvelopeAndSendsBearerWithoutLoggingLayer() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"code":"OK","message":"","data":{"id":"user-1"},"requestId":"req-1"}"""),
        )
        val client = LighthouseHttpClient(
            baseUrl = { server.url("/openBMB/api/v1").toString().trimEnd('/') },
        )

        val result = client.request(
            method = "POST",
            path = "auth/example",
            body = JSONObject().put("clientType", "ANDROID"),
            bearerToken = "access-secret",
        )

        assertEquals("user-1", result?.getString("id"))
        val request = server.takeRequest()
        assertEquals("/openBMB/api/v1/auth/example", request.path)
        assertEquals("Bearer access-secret", request.getHeader("Authorization"))
    }

    @Test
    fun preservesSafeServerErrorAndRequestId() {
        server.enqueue(
            MockResponse()
                .setResponseCode(403)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"code":"RECIPIENT_ACCESS_DENIED","message":"无权访问","requestId":"req-2"}"""),
        )
        val client = LighthouseHttpClient(
            baseUrl = { server.url("/openBMB/api/v1").toString().trimEnd('/') },
        )

        val error = assertThrows(LighthouseApiException::class.java) {
            runBlocking { client.request("GET", "households/h1") }
        }
        assertEquals(403, error.status)
        assertEquals("RECIPIENT_ACCESS_DENIED", error.code)
        assertEquals("req-2", error.requestId)
    }

    @Test
    fun cancellingTheCoroutineCancelsTheInFlightOkHttpCall() = runBlocking {
        server.enqueue(
            MockResponse()
                .setSocketPolicy(SocketPolicy.NO_RESPONSE),
        )
        val callCancelled = CountDownLatch(1)
        val okHttp = OkHttpClient.Builder()
            .eventListener(
                object : EventListener() {
                    override fun canceled(call: Call) {
                        callCancelled.countDown()
                    }
                },
            )
            .build()
        val client = LighthouseHttpClient(
            baseUrl = { server.url("/openBMB/api/v1").toString().trimEnd('/') },
            client = okHttp,
        )

        val request = launch { client.request("GET", "slow") }
        yield()
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))

        request.cancelAndJoin()

        assertTrue(callCancelled.await(1, TimeUnit.SECONDS))
    }
}
