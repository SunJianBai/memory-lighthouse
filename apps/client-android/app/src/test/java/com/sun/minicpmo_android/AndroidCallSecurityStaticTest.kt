package com.sun.minicpmo_android

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCallSecurityStaticTest {
    private val projectDir = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
        .first { it.resolve("gradle/libs.versions.toml").isFile }

    @Test
    fun telecomForegroundServiceAndCallStyleContractsAreDeclared() {
        val catalog = projectDir.resolve("gradle/libs.versions.toml").readText()
        val manifest = projectDir.resolve("app/src/main/AndroidManifest.xml").readText()
        val service = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/call/CompanionCallService.kt",
        ).readText()

        assertTrue(catalog.contains("coreTelecom = \"1.0.0\""))
        assertTrue(catalog.contains("androidx-core-telecom"))
        assertTrue(manifest.contains("android.permission.MANAGE_OWN_CALLS"))
        assertTrue(manifest.contains("android.permission.POST_NOTIFICATIONS"))
        assertTrue(manifest.contains("android.permission.FOREGROUND_SERVICE_CAMERA"))
        assertTrue(manifest.contains("android.permission.FOREGROUND_SERVICE_MICROPHONE"))
        assertTrue(manifest.contains("android.permission.FOREGROUND_SERVICE_SPECIAL_USE"))
        assertTrue(manifest.contains("android:foregroundServiceType=\"specialUse\""))
        assertTrue(manifest.contains("android:foregroundServiceType=\"camera|microphone\""))
        assertTrue(manifest.contains("android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"))
        assertTrue(service.contains("NotificationCompat.CallStyle.forIncomingCall"))
        assertTrue(service.contains("NotificationCompat.CallStyle.forOngoingCall"))
        assertTrue(service.contains("START_STICKY"))
    }

    @Test
    fun deviceSigningKeyIsNeverExportedOrPersisted() {
        val signer = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/DeviceProofSigner.kt",
        ).readText()

        assertTrue(signer.contains("AndroidKeyStore"))
        assertFalse(signer.contains("PKCS8EncodedKeySpec"))
        assertFalse(signer.contains("KEY_PRIVATE_PKCS8"))
        assertFalse(signer.contains("pair.private.encoded"))
        assertFalse(signer.contains("BouncyCastleProvider"))
        assertTrue(signer.contains("validateDescriptor"))
        assertTrue(signer.contains("deleteEntry(alias)"))
        assertFalse(signer.contains("serverSupported"))
        assertFalse(signer.contains("DeviceProofContractUnavailableException"))
    }

    @Test
    fun activityBackgroundingDoesNotOwnCallTeardown() {
        val route = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/LighthouseApp.kt",
        ).readText()
        val viewModel = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt",
        ).readText()

        assertFalse(route.contains("Lifecycle.Event.ON_STOP"))
        assertFalse(viewModel.contains("fun onAppBackgrounded()"))
        assertFalse(viewModel.contains("callController.disconnect(\"client_closed\")"))
    }

    @Test
    fun careRetryNamespaceIsStableAcrossRefreshTokenRotation() {
        val repository = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt",
        ).readText()

        assertTrue(repository.contains("vault.userCareNamespace()"))
        assertTrue(repository.contains("parseUserSession(result).also(::replaceUserSession)"))
        assertFalse(repository.contains("user-session:\$it"))
        assertFalse(repository.contains("vault.userSession()?.sessionId?.let"))
    }

    @Test
    fun everyOnsiteAnswerAndHeartbeatStopUseTheUnifiedMediaHandoff() {
        val coordinator = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/call/RemoteCallCoordinator.kt",
        ).readText()
        val route = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/LighthouseApp.kt",
        ).readText()
        val repository = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt",
        ).readText()

        assertTrue(coordinator.contains("mediaHandoff.handoffForRemoteAnswer(sessionId)"))
        assertTrue(coordinator.contains("CompanionCallService.openIncomingUi"))
        assertTrue(coordinator.contains("recordDeviceHeartbeat()"))
        assertTrue(coordinator.contains("mediaHandoff.applyHeartbeatFailure"))
        assertTrue(coordinator.contains("repository.hasActiveCompanionSession()"))
        assertTrue(coordinator.contains("repository.remoteHeartbeat(sessionId)"))
        assertTrue(route.contains("CompanionMediaStopReason.REMOTE_ANSWER"))
        assertTrue(route.contains("CompanionMediaStopReason.SERVER_DIRECTIVE"))
        assertFalse(route.contains("remoteHandoffInProgress by remember"))
        assertTrue(repository.contains("activeCompanionSessionId"))
        assertTrue(repository.contains("body.put(\"activeCompanionSessionId\", it)"))
    }
}
