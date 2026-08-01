package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.RequestedRemoteMedia
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteCallCommandRegistryTest {
    @Test
    fun processRestartReusesThePersistedIdUntilTheRequestSucceeds() {
        val persistence = MemoryRemoteCallCommandPersistence()
        val payload = remotePayload(bindingId = "binding-1")
        val firstProcess = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-1" },
            now = { 1_000L },
        )
        assertEquals("command-1", firstProcess.acquire(payload))

        val restartedProcess = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-2" },
            now = { 2_000L },
        )
        assertEquals("command-1", restartedProcess.acquire(payload))

        restartedProcess.complete(payload)
        assertNull(persistence.value)
        assertEquals(
            "command-2",
            RemoteCallCommandRegistry(
                persistence = persistence,
                createId = { "command-2" },
                now = { 3_000L },
            ).acquire(payload),
        )
    }

    @Test
    fun explicitTerminationClearsOnlyTheMatchingPayload() {
        var sequence = 0
        val persistence = MemoryRemoteCallCommandPersistence()
        val registry = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-${++sequence}" },
            now = { 1_000L },
        )
        val firstPayload = remotePayload(bindingId = "binding-1")
        val secondPayload = remotePayload(bindingId = "binding-2")
        val firstId = registry.acquire(firstPayload)
        val secondId = registry.acquire(secondPayload)

        assertNotEquals(firstId, secondId)
        registry.terminate(firstPayload)

        val restarted = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-${++sequence}" },
            now = { 2_000L },
        )
        assertEquals(secondId, restarted.acquire(secondPayload))
        assertNotEquals(firstId, restarted.acquire(firstPayload))
    }

    @Test
    fun anotherAccountNeverReusesAnUncertainRequestFromThePreviousAccount() {
        var sequence = 0
        val persistence = MemoryRemoteCallCommandPersistence()
        val registry = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-${++sequence}" },
            now = { 1_000L },
        )
        val firstAccount = remotePayload(bindingId = "binding-1", userId = "user-1")
        val secondAccount = remotePayload(bindingId = "binding-1", userId = "user-2")

        val firstId = registry.acquire(firstAccount)
        val secondId = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-${++sequence}" },
            now = { 2_000L },
        ).acquire(secondAccount)

        assertNotEquals(firstId, secondId)
    }

    @Test
    fun expiredOrFarFutureRecordsCannotKeepAnIdAliveIndefinitely() {
        val payload = remotePayload(bindingId = "binding-1")
        val expiredPersistence = MemoryRemoteCallCommandPersistence()
        RemoteCallCommandRegistry(
            persistence = expiredPersistence,
            createId = { "expired-command" },
            now = { 1_000L },
            ttlMs = 100L,
        ).acquire(payload)
        assertEquals(
            "fresh-command",
            RemoteCallCommandRegistry(
                persistence = expiredPersistence,
                createId = { "fresh-command" },
                now = { 1_101L },
                ttlMs = 100L,
            ).acquire(payload),
        )

        val futurePersistence = MemoryRemoteCallCommandPersistence()
        RemoteCallCommandRegistry(
            persistence = futurePersistence,
            createId = { "future-command" },
            now = { 1_000_000L },
        ).acquire(payload)
        assertEquals(
            "clock-reset-command",
            RemoteCallCommandRegistry(
                persistence = futurePersistence,
                createId = { "clock-reset-command" },
                now = { 1_000L },
            ).acquire(payload),
        )
    }

    @Test
    fun anAuthOrPolicyRejectionAfterAnUncertainCommitDoesNotDiscardTheId() = runBlocking {
        val persistence = MemoryRemoteCallCommandPersistence()
        val payload = remotePayload(bindingId = "binding-1")
        val firstProcess = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "original-command" },
            now = { 1_000L },
        )
        runCatching {
            firstProcess.execute(payload) {
                throw LighthouseApiException(403, "FORBIDDEN", "policy changed")
            }
        }

        val observed = mutableListOf<String>()
        RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "replacement-command" },
            now = { 2_000L },
        ).execute(payload) { idempotencyKey ->
            observed += idempotencyKey
            "session-1"
        }

        assertEquals(listOf("original-command"), observed)
        assertNull(persistence.value)
    }

    @Test
    fun requestingADifferentPayloadExplicitlyReplacesThePreviousIntent() = runBlocking {
        var sequence = 0
        val persistence = MemoryRemoteCallCommandPersistence()
        val registry = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-${++sequence}" },
            now = { 1_000L },
        )
        val previousIntent = remotePayload(bindingId = "binding-1")
        val replacementIntent = remotePayload(bindingId = "binding-2")
        runCatching {
            registry.execute(previousIntent) { throw IllegalStateException("uncertain") }
        }
        registry.execute(replacementIntent) { "session-2" }

        val afterReplacement = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-${++sequence}" },
            now = { 2_000L },
        ).acquire(previousIntent)

        assertNotEquals("command-1", afterReplacement)
    }

    @Test
    fun logoutCleanupRemovesOnlyThatAccountPendingIntent() {
        var sequence = 0
        val persistence = MemoryRemoteCallCommandPersistence()
        val registry = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-${++sequence}" },
            now = { 1_000L },
        )
        val firstAccount = remotePayload(bindingId = "binding-1", userId = "user-1")
        val secondAccount = remotePayload(bindingId = "binding-1", userId = "user-2")
        registry.acquire(firstAccount)
        val secondId = registry.acquire(secondAccount)

        registry.terminateAllForUser("user-1")

        val restarted = RemoteCallCommandRegistry(
            persistence = persistence,
            createId = { "command-${++sequence}" },
            now = { 2_000L },
        )
        assertEquals(secondId, restarted.acquire(secondAccount))
        assertNotEquals("command-1", restarted.acquire(firstAccount))
    }

    private fun remotePayload(
        bindingId: String,
        userId: String = "user-1",
    ) = RemoteCallCommandPayload(
        initiatorUserId = userId,
        householdId = "household-1",
        bindingId = bindingId,
        media = RequestedRemoteMedia(
            receiveDeviceAudio = true,
            receiveDeviceVideo = true,
            sendFamilyAudio = true,
            sendFamilyVideo = false,
        ),
    )
}

private class MemoryRemoteCallCommandPersistence : RemoteCallCommandPersistence {
    var value: String? = null

    override fun read(): String? = value

    override fun write(value: String?) {
        this.value = value
    }
}
