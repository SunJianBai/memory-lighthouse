package com.sun.minicpmo_android.data

import android.content.Context
import androidx.core.content.edit
import com.sun.minicpmo_android.model.SessionSettings

class SettingsRepository(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "minicpmo_settings",
        Context.MODE_PRIVATE,
    )

    fun load(): SessionSettings = SessionSettings(
        apiHost = preferences.getString(KEY_HOST, null) ?: SessionSettings().apiHost,
        systemPrompt = preferences.getString(KEY_PROMPT, null) ?: SessionSettings().systemPrompt,
        lengthPenalty = preferences.getFloat(KEY_LENGTH_PENALTY, 1.1f),
        chatTtsEnabled = preferences.getBoolean(KEY_CHAT_TTS, true),
    )

    fun save(settings: SessionSettings) {
        preferences.edit {
            putString(KEY_HOST, settings.apiHost.trim().trimEnd('/'))
            putString(KEY_PROMPT, settings.systemPrompt.trim())
            putFloat(KEY_LENGTH_PENALTY, settings.lengthPenalty)
            putBoolean(KEY_CHAT_TTS, settings.chatTtsEnabled)
        }
    }

    private companion object {
        const val KEY_HOST = "api_host"
        const val KEY_PROMPT = "system_prompt"
        const val KEY_LENGTH_PENALTY = "length_penalty"
        const val KEY_CHAT_TTS = "chat_tts"
    }
}
