package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.DeviceCredential
import com.sun.minicpmo_android.lighthouse.model.DeviceMediaDirective
import com.sun.minicpmo_android.lighthouse.network.LighthouseHttpClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

@OptIn(ExperimentalCoroutinesApi::class)
class LighthouseRepositoryCompanionHeartbeatOwnershipTest {
    @Test
    fun anIdleHeartbeatMustFinishBeforeANewCompanionSessionStarts() = runTest {
        val heartbeatStarted = CompletableDeferred<Unit>()
        val heartbeatResponse = CompletableDeferred<JSONObject>()
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } coAnswers {
            heartbeatStarted.complete(Unit)
            heartbeatResponse.await()
        }
        stubSuccessfulCompanionStart(http, "session-b")
        val repository = repository(http)

        val heartbeat = async { repository.heartbeat() }
        heartbeatStarted.await()
        val start = async { repository.startCompanionModel("AUDIO") }
        runCurrent()

        coVerify(exactly = 0) {
            http.request(
                "POST",
                "device/companion-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        }

        heartbeatResponse.complete(heartbeatJson())
        assertTrue(heartbeat.await().online)
        assertEquals("session-b", start.await().companionSessionId)
    }

    @Test
    fun companionHeartbeatsAreSingleFlight() = runTest {
        val firstHeartbeatStarted = CompletableDeferred<Unit>()
        val firstHeartbeatResponse = CompletableDeferred<JSONObject>()
        val secondHeartbeatStarted = CompletableDeferred<Unit>()
        val requestCount = AtomicInteger(0)
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } coAnswers {
            when (requestCount.incrementAndGet()) {
                1 -> {
                    firstHeartbeatStarted.complete(Unit)
                    firstHeartbeatResponse.await()
                }

                else -> {
                    secondHeartbeatStarted.complete(Unit)
                    heartbeatJson()
                }
            }
        }
        val repository = repository(http)

        val first = async { repository.heartbeat() }
        firstHeartbeatStarted.await()
        val second = async { repository.heartbeat() }
        runCurrent()

        assertFalse(secondHeartbeatStarted.isCompleted)
        assertEquals(1, requestCount.get())

        firstHeartbeatResponse.complete(heartbeatJson())
        first.await()
        second.await()
        assertEquals(2, requestCount.get())
    }

    @Test
    fun aFailedModelStartCompensatesTheCreatedCompanionSession() = runTest {
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } returns companionSessionJson("session-a")
        val modelFailure = IllegalStateException("model start failed")
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/model-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } throws modelFailure
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/end",
                any(),
                DEVICE_ACCESS_TOKEN,
                emptyMap(),
            )
        } returns null
        val repository = repository(http)

        val result = runCatching { repository.startCompanionModel("AUDIO") }

        assertEquals(modelFailure, result.exceptionOrNull())
        coVerify(exactly = 1) {
            http.request(
                "POST",
                "device/companion-sessions/session-a/end",
                match { it.optString("reason") == "MODEL_START_FAILED" },
                DEVICE_ACCESS_TOKEN,
                emptyMap(),
            )
        }
        assertFalse(repository.hasActiveCompanionSession())
    }

    @Test
    fun aCurrentStopTargetsAndClearsOnlyItsHeartbeatSession() = runTest {
        val http = mockk<LighthouseHttpClient>()
        stubSuccessfulCompanionStart(http, "session-a")
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } returns heartbeatJson(DeviceMediaDirective.STOP)
        val repository = repository(http)
        repository.startCompanionModel("AUDIO")
        val directives = mutableListOf<Pair<DeviceMediaDirective, String?>>()

        repository.recordCompanionHeartbeat(
            applyDirective = { directive, sessionId -> directives += directive to sessionId },
            applyActiveFailure = { error("heartbeat must succeed") },
        )

        assertEquals(listOf(DeviceMediaDirective.STOP to "session-a"), directives)
        assertFalse(repository.hasActiveCompanionSession())
    }

    @Test
    fun aStaleStopCannotReachOrClearTheSuccessorSession() = runTest {
        val heartbeatStarted = CompletableDeferred<Unit>()
        val heartbeatResponse = CompletableDeferred<JSONObject>()
        val http = mockk<LighthouseHttpClient>()
        stubSuccessfulCompanionStarts(http, "session-a", "session-b")
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } coAnswers {
            heartbeatStarted.complete(Unit)
            heartbeatResponse.await()
        }
        val repository = repository(http)
        repository.startCompanionModel("AUDIO")
        val directives = mutableListOf<Pair<DeviceMediaDirective, String?>>()

        val heartbeat = async {
            repository.recordCompanionHeartbeat(
                applyDirective = { directive, sessionId -> directives += directive to sessionId },
                applyActiveFailure = { error("stale heartbeat must not fail the successor") },
            )
        }
        heartbeatStarted.await()
        repository.clearActiveCompanionSession("session-a")
        val successor = async { repository.startCompanionModel("AUDIO") }
        heartbeatResponse.complete(heartbeatJson(DeviceMediaDirective.STOP))

        heartbeat.await()
        assertEquals("session-b", successor.await().companionSessionId)
        assertTrue(directives.isEmpty())
        assertTrue(repository.hasActiveCompanionSession())
    }

    @Test
    fun aStaleHeartbeatFailureCannotStopOrClearTheSuccessorSession() = runTest {
        val heartbeatStarted = CompletableDeferred<Unit>()
        val heartbeatResponse = CompletableDeferred<JSONObject>()
        val heartbeatFailure = IllegalStateException("heartbeat failed")
        val http = mockk<LighthouseHttpClient>()
        stubSuccessfulCompanionStarts(http, "session-a", "session-b")
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } coAnswers {
            heartbeatStarted.complete(Unit)
            heartbeatResponse.await()
        }
        val repository = repository(http)
        repository.startCompanionModel("AUDIO")
        val failedSessions = mutableListOf<String>()

        val heartbeat = async {
            runCatching {
                repository.recordCompanionHeartbeat(
                    applyDirective = { _, _ -> error("failed heartbeat has no directive") },
                    applyActiveFailure = { failedSessions += it },
                )
            }
        }
        heartbeatStarted.await()
        repository.clearActiveCompanionSession("session-a")
        val successor = async { repository.startCompanionModel("AUDIO") }
        heartbeatResponse.completeExceptionally(heartbeatFailure)

        val error = heartbeat.await().exceptionOrNull()
        assertTrue(error is IllegalStateException)
        assertEquals(heartbeatFailure.message, error?.message)
        assertEquals("session-b", successor.await().companionSessionId)
        assertTrue(failedSessions.isEmpty())
        assertTrue(repository.hasActiveCompanionSession())
    }

    @Test
    fun aCurrentHeartbeatFailureFailsClosedAndPreservesTheOriginalError() = runTest {
        val heartbeatFailure = IllegalStateException("heartbeat failed")
        val http = mockk<LighthouseHttpClient>()
        stubSuccessfulCompanionStart(http, "session-a")
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } throws heartbeatFailure
        val repository = repository(http)
        repository.startCompanionModel("AUDIO")
        val failedSessions = mutableListOf<String>()

        val result = runCatching {
            repository.recordCompanionHeartbeat(
                applyDirective = { _, _ -> error("failed heartbeat has no directive") },
                applyActiveFailure = { failedSessions += it },
            )
        }

        assertEquals(heartbeatFailure, result.exceptionOrNull())
        assertEquals(listOf("session-a"), failedSessions)
        assertFalse(repository.hasActiveCompanionSession())
    }

    @Test
    fun cancellingAHeartbeatDoesNotInventAStopOrClearTheCurrentSession() = runTest {
        val heartbeatStarted = CompletableDeferred<Unit>()
        val heartbeatResponse = CompletableDeferred<JSONObject>()
        val http = mockk<LighthouseHttpClient>()
        stubSuccessfulCompanionStart(http, "session-a")
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } coAnswers {
            heartbeatStarted.complete(Unit)
            heartbeatResponse.await()
        }
        val repository = repository(http)
        repository.startCompanionModel("AUDIO")
        val directives = mutableListOf<Pair<DeviceMediaDirective, String?>>()
        val failedSessions = mutableListOf<String>()

        val heartbeat = launch {
            repository.recordCompanionHeartbeat(
                applyDirective = { directive, sessionId -> directives += directive to sessionId },
                applyActiveFailure = { failedSessions += it },
            )
        }
        heartbeatStarted.await()
        heartbeat.cancelAndJoin()

        assertTrue(directives.isEmpty())
        assertTrue(failedSessions.isEmpty())
        assertTrue(repository.hasActiveCompanionSession())
    }

    @Test
    fun cancellingAnEndWhileItWaitsForHeartbeatStillRetiresTheExactSession() = runTest {
        val heartbeatStarted = CompletableDeferred<Unit>()
        val heartbeatResponse = CompletableDeferred<JSONObject>()
        val http = mockk<LighthouseHttpClient>()
        stubSuccessfulCompanionStarts(http, "session-a", "session-b")
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } coAnswers {
            heartbeatStarted.complete(Unit)
            heartbeatResponse.await()
        }
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/end",
                any(),
                DEVICE_ACCESS_TOKEN,
                emptyMap(),
            )
        } returns null
        val repository = repository(http)
        repository.startCompanionModel("AUDIO")
        val heartbeat = launch { repository.heartbeat() }
        heartbeatStarted.await()

        val end = launch { repository.endCompanionSession("session-a", "DEVICE_ENDED") }
        runCurrent()
        assertFalse(repository.hasActiveCompanionSession())
        end.cancelAndJoin()
        heartbeatResponse.complete(heartbeatJson())
        heartbeat.join()

        coVerify(exactly = 0) {
            http.request(
                "POST",
                "device/companion-sessions/session-a/end",
                any(),
                DEVICE_ACCESS_TOKEN,
                emptyMap(),
            )
        }
        assertEquals(
            "session-b",
            repository.startCompanionModel("AUDIO").companionSessionId,
        )
    }

    @Test
    fun cancellingAStartAfterServerCreationCompensatesExactlyOnce() = runTest {
        val modelStartEntered = CompletableDeferred<Unit>()
        val modelResponse = CompletableDeferred<JSONObject>()
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } returns companionSessionJson("session-a")
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/model-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } coAnswers {
            modelStartEntered.complete(Unit)
            modelResponse.await()
        }
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/end",
                any(),
                DEVICE_ACCESS_TOKEN,
                emptyMap(),
            )
        } returns null
        val repository = repository(http)

        val start = launch { repository.startCompanionModel("AUDIO") }
        modelStartEntered.await()
        start.cancelAndJoin()

        coVerify(exactly = 1) {
            http.request(
                "POST",
                "device/companion-sessions/session-a/end",
                match { it.optString("reason") == "MODEL_START_FAILED" },
                DEVICE_ACCESS_TOKEN,
                emptyMap(),
            )
        }
        assertFalse(repository.hasActiveCompanionSession())
    }

    @Test
    fun cleanupFailureIsSuppressedWithoutReplacingTheModelStartError() = runTest {
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } returns companionSessionJson("session-a")
        val modelFailure = IllegalStateException("model start failed")
        val cleanupFailure = IllegalStateException("cleanup failed")
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/model-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } throws modelFailure
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/end",
                any(),
                DEVICE_ACCESS_TOKEN,
                emptyMap(),
            )
        } throws cleanupFailure
        val repository = repository(http)

        val error = runCatching { repository.startCompanionModel("AUDIO") }.exceptionOrNull()

        assertEquals(modelFailure, error)
        assertEquals(1, error?.suppressed?.size)
        assertTrue(error?.suppressed?.single() is IllegalStateException)
        assertEquals(cleanupFailure.message, error?.suppressed?.single()?.message)
        assertFalse(repository.hasActiveCompanionSession())
    }

    @Test
    fun cleanupTimeoutIsSuppressedWithoutReplacingTheModelStartError() = runTest {
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } returns companionSessionJson("session-a")
        val modelFailure = IllegalStateException("model start failed")
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/model-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } throws modelFailure
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/session-a/end",
                any(),
                DEVICE_ACCESS_TOKEN,
                emptyMap(),
            )
        } coAnswers { CompletableDeferred<JSONObject?>().await() }
        val repository = repository(http)

        val error = runCatching { repository.startCompanionModel("AUDIO") }.exceptionOrNull()

        assertEquals(modelFailure, error)
        assertEquals(1, error?.suppressed?.size)
        assertTrue(error?.suppressed?.single() is TimeoutCancellationException)
        assertFalse(repository.hasActiveCompanionSession())
    }

    @Test
    fun activeFailureCleanupCannotClearASuccessorStartedByItsStopAcknowledgement() = runTest {
        val heartbeatFailure = IllegalStateException("heartbeat failed")
        val http = mockk<LighthouseHttpClient>()
        stubSuccessfulCompanionStarts(http, "session-a", "session-b")
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } throws heartbeatFailure
        val repository = repository(http)
        repository.startCompanionModel("AUDIO")
        var successorSessionId: String? = null

        val error = runCatching {
            repository.recordCompanionHeartbeat(
                applyDirective = { _, _ -> error("failed heartbeat has no directive") },
                applyActiveFailure = { failedSessionId ->
                    repository.clearActiveCompanionSession(failedSessionId)
                    successorSessionId = repository.startCompanionModel("AUDIO").companionSessionId
                },
            )
        }.exceptionOrNull()

        assertEquals(heartbeatFailure, error)
        assertEquals("session-b", successorSessionId)
        assertTrue(repository.hasActiveCompanionSession())
    }

    @Test
    fun stopAcknowledgementDoesNotHoldTheRepositoryNetworkMutex() = runTest {
        val stopCallbackStarted = CompletableDeferred<Unit>()
        val releaseStopCallback = CompletableDeferred<Unit>()
        val http = mockk<LighthouseHttpClient>()
        stubSuccessfulCompanionStarts(http, "session-a", "session-b")
        coEvery {
            http.request("POST", "device/heartbeats", any(), DEVICE_ACCESS_TOKEN, emptyMap())
        } returns heartbeatJson(DeviceMediaDirective.STOP)
        val repository = repository(http)
        repository.startCompanionModel("AUDIO")

        val heartbeat = launch {
            repository.recordCompanionHeartbeat(
                applyDirective = { directive, sessionId ->
                    assertEquals(DeviceMediaDirective.STOP, directive)
                    assertEquals("session-a", sessionId)
                    repository.clearActiveCompanionSession(requireNotNull(sessionId))
                    stopCallbackStarted.complete(Unit)
                    releaseStopCallback.await()
                },
                applyActiveFailure = { error("heartbeat must succeed") },
            )
        }
        stopCallbackStarted.await()
        val successor = async { repository.startCompanionModel("AUDIO") }
        try {
            assertEquals("session-b", successor.await().companionSessionId)
            coVerify(exactly = 2) {
                http.request(
                    "POST",
                    "device/companion-sessions",
                    any(),
                    DEVICE_ACCESS_TOKEN,
                    any(),
                )
            }
        } finally {
            releaseStopCallback.complete(Unit)
            heartbeat.join()
        }
    }

    private fun repository(http: LighthouseHttpClient): LighthouseRepository {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.deviceCredential() } returns deviceCredential()
        return LighthouseRepository(
            settings = settings,
            vault = vault,
            signer = mockk(relaxed = true),
            httpClient = http,
        )
    }

    private fun stubSuccessfulCompanionStart(
        http: LighthouseHttpClient,
        companionSessionId: String,
    ) {
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } returns companionSessionJson(companionSessionId)
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions/$companionSessionId/model-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } returns modelSessionJson(companionSessionId)
    }

    private fun heartbeatJson(
        directive: DeviceMediaDirective = DeviceMediaDirective.CONTINUE,
    ) = JSONObject()
        .put("online", true)
        .put("serverTime", "2026-08-25T00:00:00Z")
        .put("mediaDirective", directive.name)

    private fun stubSuccessfulCompanionStarts(
        http: LighthouseHttpClient,
        vararg companionSessionIds: String,
    ) {
        coEvery {
            http.request(
                "POST",
                "device/companion-sessions",
                any(),
                DEVICE_ACCESS_TOKEN,
                any(),
            )
        } returnsMany companionSessionIds.map(::companionSessionJson)
        companionSessionIds.forEach { companionSessionId ->
            coEvery {
                http.request(
                    "POST",
                    "device/companion-sessions/$companionSessionId/model-sessions",
                    any(),
                    DEVICE_ACCESS_TOKEN,
                    any(),
                )
            } returns modelSessionJson(companionSessionId)
        }
    }

    private fun companionSessionJson(companionSessionId: String) = JSONObject()
        .put("session", JSONObject().put("id", companionSessionId))

    private fun modelSessionJson(companionSessionId: String) = JSONObject()
        .put("session", JSONObject().put("id", "model-$companionSessionId"))
        .put(
            "connection",
            JSONObject()
                .put("realtimeUrl", "wss://example.invalid/realtime")
                .put("model", "MiniCPM-o 4.5"),
        )
        .put("consent", JSONObject().put("decisions", JSONObject()))
        .put(
            "prompt",
            JSONObject()
                .put("content", "陪伴提示词")
                .put("version", 1),
        )

    private fun deviceCredential() = DeviceCredential(
        credential = "credential",
        credentialId = "credential-id",
        credentialFamilyId = "credential-family-id",
        bindingId = "binding-id",
        householdId = "household-id",
        recipientId = "recipient-id",
        expiresAt = "2026-09-25T00:00:00Z",
        accessToken = DEVICE_ACCESS_TOKEN,
        accessTokenExpiresAt = "2026-08-25T01:00:00Z",
    )

    private companion object {
        const val DEVICE_ACCESS_TOKEN = "device-access-token"
    }
}
