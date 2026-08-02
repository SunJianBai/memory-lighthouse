package com.sun.minicpmo_android.lighthouse.network

import com.sun.minicpmo_android.BuildConfig
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class LighthouseApiException(
    val status: Int,
    val code: String,
    override val message: String,
    val requestId: String? = null,
) : Exception(message)

class LighthouseHttpClient(
    private val baseUrl: () -> String,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build(),
) {
    suspend fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        bearerToken: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): JSONObject? {
        val endpoint = endpoint(path)
        val requestBody = when {
            body != null -> body.toString().toRequestBody(JSON_MEDIA_TYPE)
            method in setOf("POST", "PUT", "PATCH", "DELETE") ->
                ByteArray(0).toRequestBody(JSON_MEDIA_TYPE)
            else -> null
        }
        val request = Request.Builder()
            .url(endpoint)
            .method(method, requestBody)
            .header("Accept", "application/json")
            .header("User-Agent", "MemoryLighthouse-Android/${BuildConfig.VERSION_NAME}")
            .apply {
                bearerToken?.let { header("Authorization", "Bearer $it") }
                headers.forEach { (name, value) -> header(name, value) }
            }
            .build()

        val call = client.newCall(request)
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    continuation.resumeWith(Result.failure(error))
                }

                override fun onResponse(call: Call, response: Response) {
                    continuation.resumeWith(
                        runCatching { response.use(::decodeResponse) },
                    )
                }
            })
        }
    }

    private fun decodeResponse(response: Response): JSONObject? {
        val raw = response.body?.string().orEmpty()
        val json = raw.takeIf(String::isNotBlank)?.let {
            runCatching { JSONObject(it) }.getOrNull()
        }
        if (!response.isSuccessful) {
            throw LighthouseApiException(
                status = response.code,
                code = json?.optString("code")?.takeIf(String::isNotBlank)
                    ?: "HTTP_${response.code}",
                message = json?.optString("message")?.takeIf(String::isNotBlank)
                    ?: "请求失败（HTTP ${response.code}）",
                requestId = json?.optString("requestId")?.takeIf(String::isNotBlank),
            )
        }
        if (response.code == 204 || json == null) return null
        if (json.optString("code") == "OK" && json.has("data")) {
            val data = json.opt("data")
            return when (data) {
                null, JSONObject.NULL -> null
                is JSONObject -> data
                else -> JSONObject().put("value", data)
            }
        }
        return json
    }

    private fun endpoint(path: String): String {
        val base = baseUrl().trim().trimEnd('/')
        val allowed = base.startsWith("https://") || (BuildConfig.DEBUG && base.startsWith("http://"))
        require(allowed) { "API 地址不安全" }
        return "$base/${path.trimStart('/')}"
    }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
