package com.sun.minicpmo_android.lighthouse.ui

import android.Manifest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionPermissionReadinessTest {
    @Test
    fun android13AndNewerAppAnswerRequestsNotificationAndRequestedMediaPermissions() {
        val expected = setOf(
            Manifest.permission.POST_NOTIFICATIONS,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA,
        )

        assertEquals(
            expected,
            incomingCallPermissions(
                sdkInt = 33,
                needsMicrophone = true,
                needsCamera = true,
            ).toSet(),
        )
        assertEquals(
            expected,
            incomingCallPermissions(
                sdkInt = 35,
                needsMicrophone = true,
                needsCamera = true,
            ).toSet(),
        )
    }

    @Test
    fun incompletePermissionsNeverReportTheCompanionAsReady() {
        val readiness = companionPermissionReadiness(
            notificationGranted = false,
            microphoneGranted = true,
            cameraGranted = false,
        )

        assertFalse(readiness.fullyReady)
        assertEquals(listOf("通知", "摄像头"), readiness.missingPermissionLabels)
    }

    @Test
    fun allThreePermissionsReportReady() {
        assertTrue(
            companionPermissionReadiness(
                notificationGranted = true,
                microphoneGranted = true,
                cameraGranted = true,
            ).fullyReady,
        )
    }
}
