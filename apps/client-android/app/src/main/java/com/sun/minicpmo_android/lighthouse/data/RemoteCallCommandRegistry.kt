package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.RequestedRemoteMedia
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal data class RemoteCallCommandPayload(
    val initiatorUserId: String,
    val householdId: String,
    val bindingId: String,
    val media: RequestedRemoteMedia,
) {
    fun fingerprint(): String = JSONObject()
        .put("operation", "REQUEST_REMOTE_SESSION")
        .put("initiatorUserId", initiatorUserId)
        .put("householdId", householdId)
        .put("bindingId", bindingId)
        .put("media", media.toJson())
        .toString()
}

internal interface RemoteCallCommandPersistence {
    fun read(): String?

    fun write(value: String?)
}

internal class SecureRemoteCallCommandPersistence(
    private val secureStore: SecureStore,
) : RemoteCallCommandPersistence {
    override fun read(): String? = secureStore.get(STORAGE_KEY)

    override fun write(value: String?) = secureStore.put(STORAGE_KEY, value)

    private companion object {
        const val STORAGE_KEY = "pending-remote-call-commands-v1"
    }
}

internal class RemoteCallCommandRegistry(
    private val persistence: RemoteCallCommandPersistence,
    private val createId: () -> String = { UUID.randomUUID().toString() },
    private val now: () -> Long = System::currentTimeMillis,
    private val ttlMs: Long = DEFAULT_TTL_MS,
) {
    private val lock = Any()

    init {
        require(ttlMs > 0) { "ttlMs must be positive" }
    }

    fun acquire(payload: RemoteCallCommandPayload): String =
        acquire(payload, replacePreviousIntent = false)

    private fun acquire(
        payload: RemoteCallCommandPayload,
        replacePreviousIntent: Boolean,
    ): String = synchronized(lock) {
        val fingerprint = payload.fingerprint()
        val entries = loadActiveEntries()
        val currentIntent = if (replacePreviousIntent) {
            entries.filterNot {
                it.initiatorUserId == payload.initiatorUserId &&
                    it.fingerprint != fingerprint
            }
        } else {
            entries
        }
        currentIntent.firstOrNull { it.fingerprint == fingerprint }?.idempotencyKey?.let {
            if (currentIntent != entries) save(currentIntent)
            return@synchronized it
        }
        val entry = PendingRemoteCallCommand(
            initiatorUserId = payload.initiatorUserId,
            fingerprint = fingerprint,
            idempotencyKey = createId(),
            createdAt = now(),
        )
        save(currentIntent.plus(entry).takeLast(MAX_PENDING_COMMANDS))
        entry.idempotencyKey
    }

    suspend fun <T> execute(
        payload: RemoteCallCommandPayload,
        operation: suspend (idempotencyKey: String) -> T,
    ): T {
        val result = operation(acquire(payload, replacePreviousIntent = true))
        // Every failure is potentially downstream of an already committed
        // request (including a later auth/policy rejection), so only a
        // successful response proves this retry record can be removed.
        complete(payload)
        return result
    }

    fun complete(payload: RemoteCallCommandPayload) = terminate(payload)

    fun terminate(payload: RemoteCallCommandPayload) = synchronized(lock) {
        val fingerprint = payload.fingerprint()
        save(loadActiveEntries().filterNot { it.fingerprint == fingerprint })
    }

    fun terminateAllForUser(initiatorUserId: String) = synchronized(lock) {
        save(loadActiveEntries().filterNot { it.initiatorUserId == initiatorUserId })
    }

    private fun loadActiveEntries(): List<PendingRemoteCallCommand> {
        val raw = persistence.read() ?: return emptyList()
        val decoded = runCatching {
            val root = JSONObject(raw)
            require(root.getInt("version") == FORMAT_VERSION)
            val entries = root.getJSONArray("entries")
            (0 until entries.length()).map { index ->
                val entry = entries.getJSONObject(index)
                PendingRemoteCallCommand(
                    initiatorUserId = entry.getString("initiatorUserId"),
                    fingerprint = entry.getString("fingerprint"),
                    idempotencyKey = entry.getString("idempotencyKey"),
                    createdAt = entry.getLong("createdAt"),
                ).also {
                    require(it.initiatorUserId.isNotBlank())
                    require(it.fingerprint.isNotBlank())
                    require(it.idempotencyKey.isNotBlank() && it.idempotencyKey.length <= 100)
                }
            }
        }.getOrElse {
            persistence.write(null)
            return emptyList()
        }
        val currentTime = now()
        val active = decoded.filter { entry ->
            val age = currentTime - entry.createdAt
            age <= ttlMs && age >= -MAX_FUTURE_CLOCK_SKEW_MS
        }.takeLast(MAX_PENDING_COMMANDS)
        if (active != decoded) save(active)
        return active
    }

    private fun save(entries: List<PendingRemoteCallCommand>) {
        if (entries.isEmpty()) {
            persistence.write(null)
            return
        }
        val serialized = JSONObject()
            .put("version", FORMAT_VERSION)
            .put(
                "entries",
                JSONArray().apply {
                    entries.forEach { entry ->
                        put(
                            JSONObject()
                                .put("initiatorUserId", entry.initiatorUserId)
                                .put("fingerprint", entry.fingerprint)
                                .put("idempotencyKey", entry.idempotencyKey)
                                .put("createdAt", entry.createdAt),
                        )
                    }
                },
            )
            .toString()
        persistence.write(serialized)
    }

    private data class PendingRemoteCallCommand(
        val initiatorUserId: String,
        val fingerprint: String,
        val idempotencyKey: String,
        val createdAt: Long,
    )

    private companion object {
        const val FORMAT_VERSION = 1
        const val MAX_PENDING_COMMANDS = 32
        const val DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000L
        const val MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000L
    }
}
