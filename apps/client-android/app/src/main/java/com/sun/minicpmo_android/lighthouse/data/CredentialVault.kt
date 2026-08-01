package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.DeviceCredential
import com.sun.minicpmo_android.lighthouse.model.DeviceInstallation
import com.sun.minicpmo_android.lighthouse.model.UserSession
import com.sun.minicpmo_android.lighthouse.model.PendingDeviceActivation
import org.json.JSONObject

class CredentialVault(private val secureStore: SecureStore) {
    fun userSession(): UserSession? = decode(USER_SESSION, UserSession::fromJson)

    fun saveUserSession(session: UserSession?) = save(USER_SESSION, session?.toJson())

    fun deviceInstallation(): DeviceInstallation? =
        decode(DEVICE_INSTALLATION, DeviceInstallation::fromJson)

    fun saveDeviceInstallation(installation: DeviceInstallation?) =
        save(DEVICE_INSTALLATION, installation?.toJson())

    fun deviceCredential(): DeviceCredential? =
        decode(DEVICE_CREDENTIAL, DeviceCredential::fromJson)

    fun saveDeviceCredential(credential: DeviceCredential?) =
        save(DEVICE_CREDENTIAL, credential?.toJson())

    fun pendingDeviceActivation(): PendingDeviceActivation? =
        decode(PENDING_DEVICE_ACTIVATION, PendingDeviceActivation::fromJson)

    fun savePendingDeviceActivation(activation: PendingDeviceActivation?) =
        save(PENDING_DEVICE_ACTIVATION, activation?.toJson())

    internal fun careCommandState(): String? = secureStore.get(CARE_COMMAND_STATE)

    internal fun saveCareCommandState(value: String?) = secureStore.put(CARE_COMMAND_STATE, value)

    internal fun userCareNamespace(): String? = secureStore.get(USER_CARE_NAMESPACE)

    internal fun saveUserCareNamespace(value: String?) = secureStore.put(USER_CARE_NAMESPACE, value)

    private fun <T> decode(key: String, parser: (JSONObject) -> T): T? =
        secureStore.get(key)?.let { raw -> runCatching { parser(JSONObject(raw)) }.getOrNull() }

    private fun save(key: String, json: JSONObject?) = secureStore.put(key, json?.toString())

    private companion object {
        const val USER_SESSION = "user-session-v1"
        const val DEVICE_INSTALLATION = "device-installation-v1"
        const val DEVICE_CREDENTIAL = "device-credential-v1"
        const val PENDING_DEVICE_ACTIVATION = "pending-device-activation-v1"
        const val CARE_COMMAND_STATE = "pending-care-commands-v1"
        const val USER_CARE_NAMESPACE = "user-care-namespace-v1"
    }
}
