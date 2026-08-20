package com.sun.minicpmo_android.lighthouse.call

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreTelecomPermissionPolicyTest {
    @Test
    fun systemIncomingCallRequiresVisibleNotificationsAndRequestedMediaPermissions() {
        assertFalse(
            canPresentIncomingInTelecom(
                notificationGranted = false,
                microphoneGranted = true,
                cameraGranted = true,
                needsMicrophone = true,
                needsCamera = true,
            ),
        )
        assertFalse(
            canPresentIncomingInTelecom(
                notificationGranted = true,
                microphoneGranted = false,
                cameraGranted = true,
                needsMicrophone = true,
                needsCamera = true,
            ),
        )
        assertFalse(
            canPresentIncomingInTelecom(
                notificationGranted = true,
                microphoneGranted = true,
                cameraGranted = false,
                needsMicrophone = true,
                needsCamera = true,
            ),
        )
        assertTrue(
            canPresentIncomingInTelecom(
                notificationGranted = true,
                microphoneGranted = true,
                cameraGranted = false,
                needsMicrophone = true,
                needsCamera = false,
            ),
        )
    }

    @Test
    fun appAnswerEnsuresAnAnswerableTelecomSessionBeforeAcceptingTheServerCall() = runBlocking {
        val order = mutableListOf<String>()

        val accepted = acceptIncomingFromAppWithTelecom(
            ensureTelecomSession = { order += "telecom-present" },
            acceptOnServer = {
                order += "server-accept"
                "accepted-session"
            },
            answerTelecom = { order += "telecom-answer" },
        )

        assertEquals("accepted-session", accepted)
        assertEquals(
            listOf("telecom-present", "server-accept", "telecom-answer"),
            order,
        )
    }

    @Test
    fun missingPermissionsCanBeGrantedBeforeRetryWithoutAcceptingTheServerCallEarly() {
        var permissionGranted = false
        var telecomSessionCreated = false
        var serverAcceptCount = 0
        val order = mutableListOf<String>()

        fun ensureTelecomSession() {
            val shouldCreate = incomingTelecomPresentationRequired(
                currentSessionId = if (telecomSessionCreated) "remote-1" else null,
                incomingSessionId = "remote-1",
                permissionsGranted = permissionGranted,
            )
            if (shouldCreate) {
                telecomSessionCreated = true
                order += "telecom-present"
            }
        }

        assertThrows(RemoteCallPermissionsMissingException::class.java) {
            runBlocking {
                acceptIncomingFromAppWithTelecom(
                    ensureTelecomSession = ::ensureTelecomSession,
                    acceptOnServer = {
                        serverAcceptCount += 1
                        order += "server-accept"
                    },
                    answerTelecom = { order += "telecom-answer" },
                )
            }
        }
        assertEquals(0, serverAcceptCount)
        assertFalse(telecomSessionCreated)

        permissionGranted = true
        runBlocking {
            acceptIncomingFromAppWithTelecom(
                ensureTelecomSession = ::ensureTelecomSession,
                acceptOnServer = {
                    serverAcceptCount += 1
                    order += "server-accept"
                },
                answerTelecom = { order += "telecom-answer" },
            )
        }

        assertTrue(telecomSessionCreated)
        assertEquals(1, serverAcceptCount)
        assertEquals(
            listOf("telecom-present", "server-accept", "telecom-answer"),
            order,
        )
        assertFalse(
            incomingTelecomPresentationRequired(
                currentSessionId = "remote-1",
                incomingSessionId = "remote-1",
                permissionsGranted = true,
            ),
        )
    }
}
