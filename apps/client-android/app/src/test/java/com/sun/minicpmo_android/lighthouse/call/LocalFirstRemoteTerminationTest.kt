package com.sun.minicpmo_android.lighthouse.call

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class LocalFirstRemoteTerminationTest {
    @Test
    fun timeoutWhileWaitingForLocalStopStillRunsTerminalCompensation() {
        var terminated = 0

        assertThrows(CancellationException::class.java) {
            runBlocking {
                withTimeout(25) {
                    runHandoffWithTerminalCompensation(
                        handoff = { awaitCancellation() },
                        alreadyTerminated = { false },
                        terminateBeforeRethrow = {
                            delay(10)
                            terminated += 1
                        },
                    )
                }
            }
        }

        assertEquals(1, terminated)
    }

    @Test
    fun completedInnerTerminationIsNotDuplicatedByTheHandoffBoundary() {
        var terminated = 0

        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                runHandoffWithTerminalCompensation(
                    handoff = { error("inner failed after cleanup") },
                    alreadyTerminated = { true },
                    terminateBeforeRethrow = { terminated += 1 },
                )
            }
        }

        assertEquals(0, terminated)
    }

    @Test
    fun localMediaIsReleasedBeforeTheServerIsNotified() = runBlocking {
        val order = mutableListOf<String>()

        releaseMediaBeforeServerNotification(
            releaseLocalMedia = { order += "local-release" },
            notifyServerBestEffort = { order += "server-notify" },
        )

        assertEquals(listOf("local-release", "server-notify"), order)
    }

    @Test
    fun aBlockedControlPlaneCannotUndoCompletedLocalRelease() = runBlocking {
        val order = mutableListOf<String>()

        releaseMediaBeforeServerNotification(
            releaseLocalMedia = { order += "local-release" },
            notifyServerBestEffort = {
                order += "server-notify"
                throw IllegalStateException("control_plane_unavailable")
            },
        )

        assertEquals(listOf("local-release", "server-notify"), order)
    }

    @Test
    fun cancellationQueuesCompensationAndStillPropagates() {
        var compensationQueued = false

        assertThrows(CancellationException::class.java) {
            runBlocking {
                releaseMediaBeforeServerNotification(
                    releaseLocalMedia = {},
                    notifyServerBestEffort = { throw CancellationException("outer timeout") },
                    onNotificationCancelled = { compensationQueued = true },
                )
            }
        }

        assertTrue(compensationQueued)
    }
}
