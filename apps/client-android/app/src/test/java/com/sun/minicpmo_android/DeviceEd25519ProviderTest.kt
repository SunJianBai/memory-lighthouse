package com.sun.minicpmo_android

import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

class DeviceEd25519ProviderTest {
    @Test
    fun generatedSpkiAndSignatureRoundTripWithBundledProvider() {
        val provider = BouncyCastleProvider()
        val pair = KeyPairGenerator.getInstance("Ed25519", provider).generateKeyPair()
        val message = "memory-lighthouse.device-proof.v1\naction=test\n".toByteArray()
        val signature = Signature.getInstance("Ed25519", provider).run {
            initSign(pair.private)
            update(message)
            sign()
        }
        val restoredPublicKey = KeyFactory.getInstance("Ed25519", provider)
            .generatePublic(X509EncodedKeySpec(pair.public.encoded))

        assertEquals(64, signature.size)
        assertTrue(
            Signature.getInstance("Ed25519", provider).run {
                initVerify(restoredPublicKey)
                update(message)
                verify(signature)
            },
        )
    }
}
