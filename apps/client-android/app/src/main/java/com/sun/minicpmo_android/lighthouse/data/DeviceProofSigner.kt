package com.sun.minicpmo_android.lighthouse.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.AlgorithmParameters
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.util.Base64
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

enum class DeviceProofKeyAlgorithm(
    val protocolId: String,
    val signatureAlgorithm: String,
) {
    ED25519("ED25519", "Ed25519"),
    ECDSA_P256_SHA256("ECDSA_P256_SHA256", "SHA256withECDSA"),
}

/**
 * Installation proof signer backed by a non-exportable Android Keystore key.
 *
 * Android API 33+ exposes Ed25519 in AndroidKeyStore. Older supported versions
 * use a non-exportable P-256 key and declare that algorithm during installation
 * registration. There is no software or persisted-private-key fallback.
 */
class DeviceProofSigner(private val secureStore: SecureStore) {
    val legacyKeyMaterialPurged: Boolean

    init {
        // Remove material created by the pre-Keystore implementation without
        // loading it back into the application process. Protocol-v2 Keystore
        // aliases are also deleted so rolling the APK back cannot reuse an
        // installation that predates the server-side capability gate.
        val androidKeyStore = keyStore()
        val legacyKeystoreAliasPresent = LEGACY_KEYSTORE_ALIASES.any(androidKeyStore::containsAlias)
        legacyKeyMaterialPurged = secureStore.contains(LEGACY_EXPORTED_PRIVATE_KEY_PREF) ||
            secureStore.contains(LEGACY_PUBLIC_SPKI) ||
            legacyKeystoreAliasPresent
        secureStore.remove(LEGACY_EXPORTED_PRIVATE_KEY_PREF)
        secureStore.remove(LEGACY_PUBLIC_SPKI)
        LEGACY_KEYSTORE_ALIASES.forEach { deleteInvalidAlias(androidKeyStore, it) }
    }

    @Synchronized
    fun publicKeySpki(): String {
        val key = ensureKey()
        return DeviceProofProtocol.base64Url(key.publicKeySpki)
    }

    @Synchronized
    fun publicKeyFingerprint(): String {
        val encoded = ensureKey().publicKeySpki
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
        val key = ensureKey()
        val privateKey = keyStore().getKey(key.alias, null) as? PrivateKey
            ?: error("Android Keystore device proof key is unavailable")
        val signature = Signature.getInstance(key.algorithm.signatureAlgorithm).run {
            initSign(privateKey)
            update(message)
            sign()
        }
        return DeviceProofProtocol.base64Url(signature)
    }

    @Synchronized
    fun keyAlgorithm(): DeviceProofKeyAlgorithm = ensureKey().algorithm

    private fun ensureKey(): KeyDescriptor {
        val keyStore = keyStore()
        for ((algorithm, alias) in listOf(
            DeviceProofKeyAlgorithm.ED25519 to ED25519_ALIAS,
            DeviceProofKeyAlgorithm.ECDSA_P256_SHA256 to P256_ALIAS,
        )) {
            loadValidDescriptor(keyStore, algorithm, alias)?.let { return it }
        }

        val preferred = generateAndLoad(
            algorithm = DeviceProofKeyAlgorithm.ED25519,
            alias = ED25519_ALIAS,
            generate = ::generateEd25519,
        )
        if (preferred != null) return preferred

        return requireNotNull(
            generateAndLoad(
                algorithm = DeviceProofKeyAlgorithm.ECDSA_P256_SHA256,
                alias = P256_ALIAS,
                generate = ::generateP256,
            ),
        ) { "Android Keystore cannot create a supported device proof key" }
    }

    private fun generateEd25519() {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER)
        generator.initialize(
            KeyGenParameterSpec.Builder(
                ED25519_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("ed25519"))
                .setDigests(KeyProperties.DIGEST_NONE)
                .build(),
        )
        generator.generateKeyPair()
    }

    private fun generateP256() {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER)
        generator.initialize(
            KeyGenParameterSpec.Builder(
                P256_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build(),
        )
        generator.generateKeyPair()
    }

    private fun generateAndLoad(
        algorithm: DeviceProofKeyAlgorithm,
        alias: String,
        generate: () -> Unit,
    ): KeyDescriptor? = runCatching {
        generate()
        requireNotNull(loadValidDescriptor(keyStore(), algorithm, alias))
    }.getOrElse {
        deleteInvalidAlias(keyStore(), alias)
        null
    }

    private fun loadValidDescriptor(
        keyStore: KeyStore,
        algorithm: DeviceProofKeyAlgorithm,
        alias: String,
    ): KeyDescriptor? {
        if (!keyStore.containsAlias(alias)) return null
        return runCatching {
            val publicKey = requireNotNull(keyStore.getCertificate(alias)) {
                "Android Keystore device proof certificate is unavailable"
            }.publicKey
            val privateKey = keyStore.getKey(alias, null) as? PrivateKey
                ?: error("Android Keystore device proof private key is unavailable")
            require(validateDescriptor(algorithm, publicKey, privateKey)) {
                "Android Keystore device proof alias has an incompatible algorithm"
            }
            KeyDescriptor(
                algorithm = algorithm,
                alias = alias,
                publicKeySpki = publicKey.encoded,
            )
        }.getOrElse {
            deleteInvalidAlias(keyStore, alias)
            null
        }
    }

    private fun validateDescriptor(
        algorithm: DeviceProofKeyAlgorithm,
        publicKey: PublicKey,
        privateKey: PrivateKey,
    ): Boolean = when (algorithm) {
        DeviceProofKeyAlgorithm.ED25519 ->
            publicKey.algorithm.isEd25519Name() &&
                privateKey.algorithm.isEd25519Name()
        DeviceProofKeyAlgorithm.ECDSA_P256_SHA256 ->
            publicKey is ECPublicKey &&
                privateKey.algorithm.equals("EC", ignoreCase = true) &&
                publicKey.params.matchesP256()
    }

    private fun String.isEd25519Name(): Boolean =
        ED25519_JCA_NAMES.any { equals(it, ignoreCase = true) }

    private fun ECParameterSpec.matchesP256(): Boolean {
        val expected = AlgorithmParameters.getInstance("EC").run {
            init(ECGenParameterSpec("secp256r1"))
            getParameterSpec(ECParameterSpec::class.java)
        }
        return curve == expected.curve &&
            generator == expected.generator &&
            order == expected.order &&
            cofactor == expected.cofactor
    }

    private fun deleteInvalidAlias(keyStore: KeyStore, alias: String) {
        runCatching {
            if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
        }
    }

    private fun keyStore() = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

    private data class KeyDescriptor(
        val algorithm: DeviceProofKeyAlgorithm,
        val alias: String,
        val publicKeySpki: ByteArray,
    )

    private companion object {
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val ED25519_ALIAS = "memory-lighthouse-device-proof-ed25519-v3"
        const val P256_ALIAS = "memory-lighthouse-device-proof-p256-v3"
        const val LEGACY_PUBLIC_SPKI = "device-ed25519-public-spki-v1"
        const val LEGACY_EXPORTED_PRIVATE_KEY_PREF = "device-ed25519-private-pkcs8-v1"
        val LEGACY_KEYSTORE_ALIASES = listOf(
            "memory-lighthouse-device-proof-ed25519-v2",
            "memory-lighthouse-device-proof-p256-v2",
        )
        val ED25519_JCA_NAMES = setOf("Ed25519", "EdDSA")
    }
}
