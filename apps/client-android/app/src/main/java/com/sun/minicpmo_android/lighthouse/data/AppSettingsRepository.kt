package com.sun.minicpmo_android.lighthouse.data

import android.content.Context
import androidx.core.content.edit
import com.sun.minicpmo_android.BuildConfig

class AppSettingsRepository(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "memory_lighthouse_settings_v1",
        Context.MODE_PRIVATE,
    )

    fun apiBaseUrl(): String = preferences.getString(API_BASE_URL, null)
        ?.trim()
        ?.trimEnd('/')
        ?.takeIf(String::isNotBlank)
        ?: BuildConfig.DEFAULT_API_BASE_URL

    fun saveApiBaseUrl(value: String) {
        val normalized = value.trim().trimEnd('/')
        val schemeAllowed = normalized.startsWith("https://") ||
            (BuildConfig.DEBUG && normalized.startsWith("http://"))
        require(schemeAllowed) {
            if (BuildConfig.DEBUG) "地址必须以 https:// 或 http:// 开头" else "地址必须以 https:// 开头"
        }
        preferences.edit(commit = true) { putString(API_BASE_URL, normalized) }
    }

    private companion object {
        const val API_BASE_URL = "api-base-url"
    }
}
