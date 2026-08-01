package com.sun.minicpmo_android

import com.sun.minicpmo_android.lighthouse.data.DeviceProofKeyAlgorithm
import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceProofKeyAlgorithmTest {
    @Test
    fun serverContractRemainsExplicitForEveryKeystoreAlgorithm() {
        assertEquals("ED25519", DeviceProofKeyAlgorithm.ED25519.protocolId)
        assertEquals("Ed25519", DeviceProofKeyAlgorithm.ED25519.signatureAlgorithm)

        assertEquals(
            "ECDSA_P256_SHA256",
            DeviceProofKeyAlgorithm.ECDSA_P256_SHA256.protocolId,
        )
        assertEquals(
            "SHA256withECDSA",
            DeviceProofKeyAlgorithm.ECDSA_P256_SHA256.signatureAlgorithm,
        )
    }
}
