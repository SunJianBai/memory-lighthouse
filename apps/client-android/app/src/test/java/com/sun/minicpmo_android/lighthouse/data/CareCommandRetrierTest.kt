package com.sun.minicpmo_android.lighthouse.data

import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CareCommandRetrierTest {
    @Test
    fun networkUncertaintyRetriesWithTheSameCommandId() = runBlocking {
        val ids = mutableListOf<String>()
        val retrier = CareCommandRetrier(createId = { "command-1" })

        val result = retrier.execute("claim:task-1:v0") { commandId ->
            ids += commandId
            if (ids.size == 1) throw IOException("connection reset")
            "done"
        }

        assertEquals("done", result)
        assertEquals(listOf("command-1", "command-1"), ids)
    }

    @Test
    fun processRestartReusesDurableIdAfterEveryFailureType() = runBlocking {
        val persistence = MemoryCareCommandPersistence()
        val firstProcess = CareCommandRetrier(
            persistence = persistence,
            namespace = { "user:user-1" },
            createId = { "command-1" },
            now = { 1_000L },
        )
        runCatching {
            firstProcess.execute("resolve:task-1:v0") {
                throw IllegalStateException("response lost after commit")
            }
        }

        val observed = mutableListOf<String>()
        CareCommandRetrier(
            persistence = persistence,
            namespace = { "user:user-1" },
            createId = { "command-2" },
            now = { 2_000L },
        ).execute("resolve:task-1:v0") { commandId ->
            observed += commandId
            "done"
        }

        assertEquals(listOf("command-1"), observed)
        assertEquals(null, persistence.read())
    }

    @Test
    fun completePayloadsAndUserSessionsAreIsolatedWithoutPersistingPlaintext() = runBlocking {
        val persistence = MemoryCareCommandPersistence()
        var sequence = 0
        val firstUser = CareCommandRetrier(
            persistence = persistence,
            namespace = { "user:user-1" },
            createId = { "command-${++sequence}" },
        )
        runCatching {
            firstUser.execute("family-task:household-1:task-1:v1:private-note") {
                throw IOException("offline")
            }
        }
        runCatching {
            firstUser.execute("family-task:household-1:task-2:v1:private-note") {
                throw IOException("offline")
            }
        }

        val otherUserObserved = mutableListOf<String>()
        CareCommandRetrier(
            persistence = persistence,
            namespace = { "user:user-2" },
            createId = { "other-user-command" },
        ).execute("family-task:household-1:task-1:v1:private-note") {
            otherUserObserved += it
            "done"
        }

        assertEquals(listOf("other-user-command"), otherUserObserved)
        assertFalse(persistence.read().orEmpty().contains("task-1"))
        assertFalse(persistence.read().orEmpty().contains("private-note"))
    }

    @Test
    fun expiredIdIsNotReusedAfterTheBoundedRetryWindow() = runBlocking {
        val persistence = MemoryCareCommandPersistence()
        var currentTime = 1_000L
        var sequence = 0
        val retrier = CareCommandRetrier(
            persistence = persistence,
            namespace = { "user:user-1" },
            createId = { "command-${++sequence}" },
            now = { currentTime },
            ttlMs = 100L,
        )
        runCatching {
            retrier.execute("verify:occurrence-1:v1") { throw IOException("offline") }
        }
        currentTime = 1_101L

        val observed = mutableListOf<String>()
        retrier.execute("verify:occurrence-1:v1") {
            observed += it
            "done"
        }

        assertEquals(listOf("command-2"), observed)
    }

    private class MemoryCareCommandPersistence : CareCommandPersistence {
        private var value: String? = null

        override fun read(): String? = value

        override fun write(value: String?) {
            this.value = value
        }
    }
}
