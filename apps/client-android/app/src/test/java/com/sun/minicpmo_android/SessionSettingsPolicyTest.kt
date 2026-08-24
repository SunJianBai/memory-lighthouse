package com.sun.minicpmo_android

import com.sun.minicpmo_android.model.DEFAULT_LENGTH_PENALTY
import com.sun.minicpmo_android.model.AppUiState
import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.model.SessionSettings
import com.sun.minicpmo_android.model.withServerManagedSession
import com.sun.minicpmo_android.model.migrateStoredLengthPenalty
import com.sun.minicpmo_android.network.RealtimeProtocol
import com.sun.minicpmo_android.ui.answerLengthEndpointLabels
import com.sun.minicpmo_android.ui.answerLengthStateDescription
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionSettingsPolicyTest {
    @Test
    fun answerLengthSliderExplainsBothDirections() {
        assertEquals("更简短", answerLengthEndpointLabels().first)
        assertEquals("更详细", answerLengthEndpointLabels().second)
        assertEquals("更简短，0.5", answerLengthStateDescription(0.5f))
        assertEquals("适中，1.0", answerLengthStateDescription(1.0f))
        assertEquals("更详细，2.0", answerLengthStateDescription(2.0f))
    }

    @Test
    fun newSessionsDefaultToTheSameConciseLengthPenaltyAsWeb() {
        assertEquals(1.0f, DEFAULT_LENGTH_PENALTY, 0f)
    }

    @Test
    fun legacyDefaultIsMigratedWithoutOverwritingARealUserPreference() {
        assertEquals(1.0f, migrateStoredLengthPenalty(1.1f, 1), 0f)
        assertEquals(0.8f, migrateStoredLengthPenalty(0.8f, 1), 0f)
        assertEquals(1.1f, migrateStoredLengthPenalty(1.1f, 2), 0f)
    }

    @Test
    fun serverConfigurationBecomesEffectiveWithoutReplacingLocalPreferences() {
        val local = SessionSettings(
            apiHost = "https://developer.example.com",
            systemPrompt = "本地调试提示词",
            lengthPenalty = 0.9f,
        )

        val state = AppUiState(settings = local).withServerManagedSession(
            realtimeUrl = "wss://server.example.com/v1/realtime",
            systemPrompt = "服务端最终提示词",
            model = "MiniCPM-o-4.5",
            promptVersion = 3,
            memoryCount = 4,
            routineCount = 2,
        )

        assertEquals(local, state.settings)
        assertEquals("wss://server.example.com/v1/realtime", state.effectiveSession?.apiHost)
        assertEquals("服务端最终提示词", state.effectiveSession?.systemPrompt)
        assertEquals(0.9f, state.effectiveSession?.lengthPenalty)
        assertEquals("已准备 4 条记忆和 2 项日程", state.effectiveSession?.summary)
    }

    @Test
    fun chatTtsIsNeverPresentedAsAnAudioOrVideoPreference() {
        val settings = SessionSettings(chatTtsEnabled = true)

        assertTrue(settings.chatTtsEnabledFor(RealtimeMode.CHAT))
        assertFalse(settings.chatTtsEnabledFor(RealtimeMode.AUDIO))
        assertFalse(settings.chatTtsEnabledFor(RealtimeMode.VIDEO))
    }

    @Test
    fun androidSessionInitConsumesTheServerEffectivePrompt() {
        val local = SessionSettings(
            apiHost = "https://developer.example.com",
            systemPrompt = "本地调试提示词",
        )
        val effective = requireNotNull(
            AppUiState(settings = local).withServerManagedSession(
                realtimeUrl = "wss://server.example.com/v1/realtime",
                systemPrompt = "服务端最终提示词",
                model = "MiniCPM-o-4.5",
                promptVersion = 3,
                memoryCount = 1,
                routineCount = 1,
            ).effectiveSession,
        )

        val payload = JSONObject(
            RealtimeProtocol.sessionInit(effective.connectionSettings(local)),
        ).getJSONObject("payload")

        assertEquals("服务端最终提示词", payload.getString("system_prompt"))
        assertEquals(
            1.0,
            payload.getJSONObject("config").getDouble("length_penalty"),
            0.0,
        )
    }
}
