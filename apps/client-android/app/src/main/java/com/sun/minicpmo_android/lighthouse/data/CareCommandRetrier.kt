package com.sun.minicpmo_android.lighthouse.data

import java.io.IOException
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal interface CareCommandPersistence {
    fun read(): String?

    fun write(value: String?)
}

internal class VaultCareCommandPersistence(
    private val vault: CredentialVault,
) : CareCommandPersistence {
    override fun read(): String? = vault.careCommandState()

    override fun write(value: String?) = vault.saveCareCommandState(value)
}

internal class CareCommandRetrier(
    private val persistence: CareCommandPersistence = VolatileCareCommandPersistence(),
    private val namespace: () -> String = { "test" },
    private val createId: () -> String = { UUID.randomUUID().toString() },
    private val now: () -> Long = System::currentTimeMillis,
    private val ttlMs: Long = DEFAULT_TTL_MS,
) {
    private val lock = Any()

    init {
        require(ttlMs > 0) { "ttlMs must be positive" }
    }

    suspend fun <T> execute(
        normalizedCommand: String,
        operation: suspend (commandId: String) -> T,
    ): T {
        val activeNamespace = namespace().trim()
        require(activeNamespace.isNotEmpty()) { "Care command namespace is unavailable" }
        val fingerprint = fingerprint(normalizedCommand)
        val commandId = acquire(activeNamespace, fingerprint)
        return try {
            val result = try {
                operation(commandId)
            } catch (_: IOException) {
                operation(commandId)
            }
            complete(activeNamespace, fingerprint)
            result
        } catch (error: Throwable) {
            // Any failure can arrive after the server committed. Retain the
            // durable ID so a process restart or later tap cannot duplicate it.
            throw error
        }
    }

    fun terminateNamespace(value: String) = synchronized(lock) {
        save(loadActiveEntries().filterNot { it.namespace == value })
    }

    private fun acquire(activeNamespace: String, fingerprint: String): String = synchronized(lock) {
        val entries = loadActiveEntries()
        entries.firstOrNull {
            it.namespace == activeNamespace && it.fingerprint == fingerprint
        }?.idempotencyKey?.let { return@synchronized it }

        val entry = PendingCareCommand(
            namespace = activeNamespace,
            fingerprint = fingerprint,
            idempotencyKey = createId(),
            createdAt = now(),
        )
        // Persistence happens before the caller may send the request.
        save(entries.plus(entry).takeLast(MAX_PENDING_COMMANDS))
        entry.idempotencyKey
    }

    private fun complete(activeNamespace: String, fingerprint: String) = synchronized(lock) {
        save(
            loadActiveEntries().filterNot {
                it.namespace == activeNamespace && it.fingerprint == fingerprint
            },
        )
    }

    private fun loadActiveEntries(): List<PendingCareCommand> {
        val raw = persistence.read() ?: return emptyList()
        val decoded = runCatching {
            val root = JSONObject(raw)
            require(root.getInt("version") == FORMAT_VERSION)
            val entries = root.getJSONArray("entries")
            (0 until entries.length()).map { index ->
                val entry = entries.getJSONObject(index)
                PendingCareCommand(
                    namespace = entry.getString("namespace"),
                    fingerprint = entry.getString("fingerprint"),
                    idempotencyKey = entry.getString("idempotencyKey"),
                    createdAt = entry.getLong("createdAt"),
                ).also {
                    require(it.namespace.isNotBlank())
                    require(it.fingerprint.isNotBlank())
                    require(it.idempotencyKey.isNotBlank() && it.idempotencyKey.length <= 100)
                }
            }
        }.getOrElse {
            throw IllegalStateException(
                "Pending care command state is unreadable; refusing an unsafe retry",
                it,
            )
        }
        val currentTime = now()
        val active = decoded.filter { entry ->
            val age = currentTime - entry.createdAt
            age <= ttlMs && age >= -MAX_FUTURE_CLOCK_SKEW_MS
        }.takeLast(MAX_PENDING_COMMANDS)
        if (active != decoded) save(active)
        return active
    }

    private fun save(entries: List<PendingCareCommand>) {
        if (entries.isEmpty()) {
            persistence.write(null)
            return
        }
        persistence.write(
            JSONObject()
                .put("version", FORMAT_VERSION)
                .put(
                    "entries",
                    JSONArray().apply {
                        entries.forEach { entry ->
                            put(
                                JSONObject()
                                    .put("namespace", entry.namespace)
                                    .put("fingerprint", entry.fingerprint)
                                    .put("idempotencyKey", entry.idempotencyKey)
                                    .put("createdAt", entry.createdAt),
                            )
                        }
                    },
                )
                .toString(),
        )
    }

    private fun fingerprint(normalizedCommand: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256")
                .digest(normalizedCommand.toByteArray(Charsets.UTF_8)),
        )

    private data class PendingCareCommand(
        val namespace: String,
        val fingerprint: String,
        val idempotencyKey: String,
        val createdAt: Long,
    )

    private class VolatileCareCommandPersistence : CareCommandPersistence {
        private var value: String? = null

        override fun read(): String? = value

        override fun write(value: String?) {
            this.value = value
        }
    }

    private companion object {
        const val FORMAT_VERSION = 1
        const val MAX_PENDING_COMMANDS = 64
        const val DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000L
        const val MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000L
    }
}
