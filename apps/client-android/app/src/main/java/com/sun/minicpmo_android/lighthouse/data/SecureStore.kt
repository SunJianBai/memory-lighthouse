package com.sun.minicpmo_android.lighthouse.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.util.Base64

/**
 * Small secret store backed by a non-exportable Android Keystore AES key.
 * Refresh tokens and device credentials never appear in plain SharedPreferences
 * or logs. Device signing keys are held separately by Android Keystore and are
 * never exportable into this store.
 */
class SecureStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    @Synchronized
    fun put(key: String, value: String?) {
        if (value == null) {
            preferences.edit { remove(key) }
            return
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val payload = buildString {
            append(FORMAT_VERSION)
            append(':')
            append(Base64.getUrlEncoder().withoutPadding().encodeToString(cipher.iv))
            append(':')
            append(Base64.getUrlEncoder().withoutPadding().encodeToString(encrypted))
        }
        preferences.edit(commit = true) { putString(key, payload) }
    }

    @Synchronized
    fun get(key: String): String? {
        val payload = preferences.getString(key, null) ?: return null
        return runCatching {
            val parts = payload.split(':', limit = 3)
            require(parts.size == 3 && parts[0] == FORMAT_VERSION)
            val decoder = Base64.getUrlDecoder()
            val iv = decoder.decode(parts[1])
            val encrypted = decoder.decode(parts[2])
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(encrypted), Charsets.UTF_8)
        }.getOrElse {
            // A lock-screen reset or restored preference can invalidate the key.
            // The safe recovery is to discard that one unusable secret and ask
            // the user to authenticate/activate again.
            preferences.edit(commit = true) { remove(key) }
            null
        }
    }

    fun remove(key: String) = put(key, null)

    fun contains(key: String): Boolean = preferences.contains(key)

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER,
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val PREFERENCES_NAME = "memory_lighthouse_secure_v1"
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val KEY_ALIAS = "memory-lighthouse-aes-gcm-v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val FORMAT_VERSION = "v1"
    }
}
