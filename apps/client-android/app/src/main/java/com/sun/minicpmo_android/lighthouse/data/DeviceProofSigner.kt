package com.sun.minicpmo_android.lighthouse.data

import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.util.Locale

enum class ActivationProofType { QR_SECRET, DYNAMIC_CODE }

object DeviceProofProtocol {
    fun normalizeProof(type: ActivationProofType, proof: String): String =
        if (type == ActivationProofType.DYNAMIC_CODE) proof.trim().uppercase(Locale.ROOT) else proof

    fun proofDigest(type: ActivationProofType, proof: String): String = base64Url(
        MessageDigest.getInstance("SHA-256").digest(
            buildList<Byte> {
                addAll(type.name.toByteArray(Charsets.UTF_8).toList())
                add(0)
                addAll(normalizeProof(type, proof).toByteArray(Charsets.UTF_8).toList())
            }.toByteArray(),
        ),
    )

    fun credentialDigest(credential: String): String = base64Url(
        MessageDigest.getInstance("SHA-256").digest(credential.toByteArray(Charsets.UTF_8)),
    )

    fun claimMessage(
        publicId: String,
        installationId: String,
        serverNonce: String,
        proofType: ActivationProofType,
        proof: String,
    ): ByteArray = canonical(
        action = "claim",
        fields = listOf(
            "public-id" to publicId,
            "installation-id" to installationId,
            "server-nonce" to serverNonce,
            "proof-type" to proofType.name,
            "proof-sha256" to proofDigest(proofType, proof),
        ),
    )

    fun exchangeMessage(
        challengeId: String,
        installationId: String,
        approvedAt: String,
    ): ByteArray = canonical(
        action = "exchange",
        fields = listOf(
            "challenge-id" to challengeId,
            "installation-id" to installationId,
            "approved-at" to approvedAt,
        ),
    )

    fun refreshMessage(
        credentialId: String,
        bindingId: String,
        credential: String,
    ): ByteArray = canonical(
        action = "refresh",
        fields = listOf(
            "credential-id" to credentialId,
            "binding-id" to bindingId,
            "credential-sha256" to credentialDigest(credential),
        ),
    )

    fun base64Url(bytes: ByteArray): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    private fun canonical(action: String, fields: List<Pair<String, String>>): ByteArray {
        require(action.none { it == '\n' || it == '\r' })
        fields.forEach { (_, value) -> require(value.none { it == '\n' || it == '\r' }) }
        return buildString {
            append("memory-lighthouse.device-proof.v1\n")
            append("action=")
            append(action)
            append('\n')
            fields.forEach { (name, value) ->
                append(name)
                append('=')
                append(value)
                append('\n')
            }
        }.toByteArray(Charsets.UTF_8)
    }
}

class DeviceProofSigner(private val secureStore: SecureStore) {
    private val ed25519Provider by lazy { BouncyCastleProvider() }
    @Synchronized
    fun publicKeySpki(): String {
        ensureKeyPair()
        return requireNotNull(secureStore.get(KEY_PUBLIC_SPKI))
    }

    @Synchronized
    fun publicKeyFingerprint(): String {
        val encoded = Base64.getUrlDecoder().decode(publicKeySpki())
        return try {
            DeviceProofProtocol.base64Url(
                MessageDigest.getInstance("SHA-256").digest(encoded),
            )
        } finally {
            encoded.fill(0)
        }
    }

    @Synchronized
    fun sign(message: ByteArray): String {
        ensureKeyPair()
        val encoded = Base64.getUrlDecoder().decode(
            requireNotNull(secureStore.get(KEY_PRIVATE_PKCS8)),
        )
        return try {
            val privateKey = KeyFactory.getInstance(ALGORITHM, ed25519Provider)
                .generatePrivate(PKCS8EncodedKeySpec(encoded))
            DeviceProofProtocol.base64Url(sign(privateKey, message))
        } finally {
            encoded.fill(0)
        }
    }

    private fun sign(privateKey: PrivateKey, message: ByteArray): ByteArray =
        Signature.getInstance(ALGORITHM, ed25519Provider).run {
            initSign(privateKey)
            update(message)
            sign()
        }

    private fun ensureKeyPair() {
        if (
            secureStore.get(KEY_PUBLIC_SPKI) != null &&
            secureStore.get(KEY_PRIVATE_PKCS8) != null
        ) {
            return
        }
        val pair = KeyPairGenerator.getInstance(ALGORITHM, ed25519Provider).generateKeyPair()
        secureStore.put(KEY_PUBLIC_SPKI, DeviceProofProtocol.base64Url(pair.public.encoded))
        secureStore.put(KEY_PRIVATE_PKCS8, DeviceProofProtocol.base64Url(pair.private.encoded))
    }

    private companion object {
        const val ALGORITHM = "Ed25519"
        const val KEY_PUBLIC_SPKI = "device-ed25519-public-spki-v1"
        const val KEY_PRIVATE_PKCS8 = "device-ed25519-private-pkcs8-v1"
    }
}
