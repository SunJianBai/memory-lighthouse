package com.sun.minicpmo_android

import com.sun.minicpmo_android.lighthouse.data.ActivationProofType
import com.sun.minicpmo_android.lighthouse.data.DeviceProofProtocol
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class DeviceProofProtocolTest {
    @Test
    fun claimMessageMatchesServerCanonicalFormat() {
        val message = DeviceProofProtocol.claimMessage(
            publicId = "ML-ABC234",
            installationId = "01HZY123456789ABCDEFGHJKM",
            serverNonce = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            proofType = ActivationProofType.DYNAMIC_CODE,
            proof = " abcd2345 ",
        ).toString(Charsets.UTF_8)

        assertEquals(
            listOf(
                "memory-lighthouse.device-proof.v1",
                "action=claim",
                "public-id=ML-ABC234",
                "installation-id=01HZY123456789ABCDEFGHJKM",
                "server-nonce=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "proof-type=DYNAMIC_CODE",
                "proof-sha256=${DeviceProofProtocol.proofDigest(ActivationProofType.DYNAMIC_CODE, "ABCD2345")}",
                "",
            ).joinToString("\n"),
            message,
        )
    }

    @Test
    fun dynamicProofNormalizationIsStable() {
        val first = DeviceProofProtocol.proofDigest(
            ActivationProofType.DYNAMIC_CODE,
            " abcd2345 ",
        )
        val second = DeviceProofProtocol.proofDigest(
            ActivationProofType.DYNAMIC_CODE,
            "ABCD2345",
        )
        assertEquals(first, second)
        assertEquals("TBPhzBPPxli_kmldAd7trYvijeVxv2lrGPwKwQXsMnc", first)
        assertFalse(first.contains('='))
    }

    @Test
    fun recoveryMessageUsesAFreshTokenBoundProofAction() {
        val message = DeviceProofProtocol.exchangeRecoveryMessage(
            challengeId = "01HZY123456789ABCDEFGHJKM",
            installationId = "01HZY987654321ABCDEFGHJKM",
            recoveryToken = "v1.recovery-token.signature",
        ).toString(Charsets.UTF_8)

        assertEquals(
            listOf(
                "memory-lighthouse.device-proof.v1",
                "action=exchange-recovery",
                "challenge-id=01HZY123456789ABCDEFGHJKM",
                "installation-id=01HZY987654321ABCDEFGHJKM",
                "recovery-token=v1.recovery-token.signature",
                "",
            ).joinToString("\n"),
            message,
        )
    }
}
