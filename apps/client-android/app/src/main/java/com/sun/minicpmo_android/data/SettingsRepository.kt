package com.sun.minicpmo_android.data

import android.content.Context
import androidx.core.content.edit
import com.sun.minicpmo_android.model.CURRENT_SESSION_SETTINGS_VERSION
import com.sun.minicpmo_android.model.SessionSettings
import com.sun.minicpmo_android.model.migrateStoredLengthPenalty

class SettingsRepository(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "minicpmo_settings",
        Context.MODE_PRIVATE,
    )

    fun load(): SessionSettings {
        val storedVersion = preferences.getInt(KEY_SETTINGS_VERSION, 1)
        val storedLengthPenalty = preferences.takeIf { it.contains(KEY_LENGTH_PENALTY) }
            ?.getFloat(KEY_LENGTH_PENALTY, SessionSettings().lengthPenalty)
        val lengthPenalty = migrateStoredLengthPenalty(storedLengthPenalty, storedVersion)
        if (storedVersion < CURRENT_SESSION_SETTINGS_VERSION) {
            preferences.edit {
                remove(KEY_HOST)
                remove(KEY_PROMPT)
                putFloat(KEY_LENGTH_PENALTY, lengthPenalty)
                putInt(KEY_SETTINGS_VERSION, CURRENT_SESSION_SETTINGS_VERSION)
            }
        }
        return SessionSettings(
            lengthPenalty = lengthPenalty,
            chatTtsEnabled = preferences.getBoolean(KEY_CHAT_TTS, true),
        )
    }

    fun save(settings: SessionSettings) {
        preferences.edit {
            remove(KEY_HOST)
            remove(KEY_PROMPT)
            putFloat(KEY_LENGTH_PENALTY, settings.lengthPenalty)
            putBoolean(KEY_CHAT_TTS, settings.chatTtsEnabled)
            putInt(KEY_SETTINGS_VERSION, CURRENT_SESSION_SETTINGS_VERSION)
        }
    }

    private companion object {
        const val KEY_HOST = "api_host"
        const val KEY_PROMPT = "system_prompt"
        const val KEY_LENGTH_PENALTY = "length_penalty"
        const val KEY_CHAT_TTS = "chat_tts"
        const val KEY_SETTINGS_VERSION = "settings_version"
    }
}
