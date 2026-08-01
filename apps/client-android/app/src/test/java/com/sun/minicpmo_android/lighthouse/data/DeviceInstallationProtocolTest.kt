package com.sun.minicpmo_android.lighthouse.data

import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceInstallationProtocolTest {
    @Test
    fun registrationDeclaresNonExportableKeyProtection() {
        val payload = deviceInstallationRegistrationPayload(
            installationPublicKeySpki = "public-spki",
            installationKeyAlgorithm = "ECDSA_P256_SHA256",
            manufacturer = "Device maker",
            model = "Companion model",
            osVersion = "15",
            appVersion = "0.2.0",
        )

        assertEquals("public-spki", payload.getString("installationPublicKeySpki"))
        assertEquals("ECDSA_P256_SHA256", payload.getString("installationKeyAlgorithm"))
        assertEquals("NON_EXPORTABLE_V1", payload.getString("keyProtection"))
        assertEquals("ANDROID", payload.getString("platform"))
        assertEquals("Device maker", payload.getString("manufacturer"))
        assertEquals("Companion model", payload.getString("model"))
        assertEquals("15", payload.getString("osVersion"))
        assertEquals("0.2.0", payload.getString("appVersion"))
    }
}
