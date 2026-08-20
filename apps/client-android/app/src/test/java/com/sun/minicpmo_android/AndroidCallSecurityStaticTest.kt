package com.sun.minicpmo_android

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCallSecurityStaticTest {
    private val projectDir = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) {
        it.parentFile
    }
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
        assertTrue(coordinator.contains("renewHeartbeat = repository::remoteHeartbeat"))
        assertTrue(coordinator.contains("RemoteHeartbeatLeaseGuard"))
        assertTrue(coordinator.contains("if (!leaseGuard.renew(sessionId)) return@launch"))
        assertFalse(coordinator.contains("runCatching { repository.remoteHeartbeat(sessionId) }"))
        assertTrue(coordinator.contains("releaseMediaBeforeServerNotification"))
        assertTrue(coordinator.contains("repository.declineDeviceRemoteSession(sessionId)"))
        assertTrue(coordinator.contains("accept may have committed while its response was"))
        val localFirstStart = coordinator.indexOf("private suspend fun terminateLocalFirst")
        val localFirstBody = coordinator.substring(localFirstStart)
        assertTrue(
            localFirstBody.indexOf("releaseLocal(") <
                localFirstBody.indexOf("notifyServerBestEffort = serverNotification"),
        )
        assertTrue(route.contains("CompanionMediaStopReason.REMOTE_ANSWER"))
        assertTrue(route.contains("CompanionMediaStopReason.SERVER_DIRECTIVE"))
        assertFalse(route.contains("remoteHandoffInProgress by remember"))
        assertTrue(repository.contains("activeCompanionSessionId"))
        assertTrue(repository.contains("body.put(\"activeCompanionSessionId\", it)"))
        val joinTicketAnchor = coordinator.indexOf(
            "val joinTicketRenewalStartedAtMillis = monotonicNowMillis()",
        )
        val joinTicketRequest = coordinator.indexOf("repository.deviceJoinTicket(remote.id)")
        assertTrue(joinTicketAnchor in 0 until joinTicketRequest)
        assertTrue(
            coordinator.contains(
                "initialSuccessfulRenewalAtMillis = joinTicketRenewalStartedAtMillis",
            ),
        )
    }

    @Test
    fun activatedCompanionModeUsesOnlyDeviceIdentityUntilFreshFamilyLogin() {
        val viewModel = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt",
        ).readText()
        val models = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/model/LighthouseModels.kt",
        ).readText()
        val route = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/LighthouseApp.kt",
        ).readText()
        val repository = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt",
        ).readText()

        assertTrue(models.contains("companionDeviceLocked: Boolean = false"))
        assertTrue(viewModel.contains("enterLockedCompanionMode"))
        assertTrue(viewModel.contains("repository.revokeUserSessionForCompanionMode()"))
        assertTrue(viewModel.contains("if (tryRestoreLockedCompanionMode())"))
        assertTrue(route.contains("!state.signedIn && !state.companionDeviceLocked"))
        assertTrue(route.contains("onRequireFamilyAuthentication"))
        assertTrue(route.contains("state.companionDeviceLocked"))
        val activationStart = viewModel.indexOf("private fun startActivationPolling")
        val activationEnd = viewModel.indexOf("private fun startFamilyRemotePolling", activationStart)
        val activationBody = viewModel.substring(activationStart, activationEnd)
        assertTrue(
            activationBody.indexOf("enterLockedCompanionMode") <
                activationBody.indexOf("repository.getDeviceContext()"),
        )
        val isolationStart = repository.indexOf("suspend fun revokeUserSessionForCompanionMode")
        val isolationEnd = repository.indexOf("suspend fun restoreUser", isolationStart)
        val isolationBody = repository.substring(isolationStart, isolationEnd)
        assertTrue(isolationBody.indexOf("clearUserSession()") < isolationBody.indexOf("http.request("))
        assertFalse(isolationBody.contains("saveDeviceCredential(null)"))
        val clearStart = repository.indexOf("private fun clearUserSession()")
        val clearEnd = repository.indexOf("private suspend fun deviceRequest", clearStart)
        assertTrue(repository.substring(clearStart, clearEnd).contains("vault.saveUserSession(null)"))
    }

    @Test
    fun sensitiveFamilyDeviceAndAuthorityActionsRequireTransientPassword() {
        val contract = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/FamilyApiContract.kt",
        ).readText()
        val repository = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt",
        ).readText()
        val viewModel = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt",
        ).readText()
        val familyUi = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt",
        ).readText()

        assertTrue(contract.contains("careAuthoritiesPath"))
        assertTrue(contract.contains("careAuthorityBody"))
        assertTrue(contract.contains("revokeBindingBody"))
        assertTrue(contract.contains("updateHouseholdMemberBody"))
        assertTrue(contract.contains("removeHouseholdMemberBody"))
        assertTrue(repository.contains("suspend fun putCareAuthority"))
        assertTrue(repository.contains("suspend fun revokeBinding"))
        assertTrue(repository.contains("suspend fun updateHouseholdMember"))
        assertTrue(repository.contains("suspend fun removeHouseholdMember"))
        assertTrue(
            viewModel.contains(
                "require(member.userId != currentUserId) { \"不能修改自己的家庭角色\" }",
            ),
        )
        assertTrue(
            viewModel.contains(
                "require(member.userId != currentUserId) { \"不能移除自己的家庭成员身份\" }",
            ),
        )
        assertTrue(familyUi.contains("currentPassword"))
        assertFalse(familyUi.contains("var currentPassword by rememberSaveable"))
        assertTrue(familyUi.contains("currentPassword = \"\""))
    }

    @Test
    fun acceptedMediaFailureRemainsVisibleUntilTheOnsiteUserDismissesIt() {
        val coordinator = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/call/RemoteCallCoordinator.kt",
        ).readText()
        val viewModel = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt",
        ).readText()
        val models = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/model/LighthouseModels.kt",
        ).readText()
        val route = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/LighthouseApp.kt",
        ).readText()

        assertTrue(coordinator.contains("current.lifecycle.remoteFailureMessage()"))
        assertTrue(coordinator.contains("failureMessage = failureMessage"))
        assertTrue(models.contains("remoteCallFailureTitle: String? = null"))
        assertTrue(models.contains("remoteCallFailure: String? = null"))
        assertTrue(viewModel.contains("fun dismissRemoteCallFailure()"))
        assertTrue(route.contains("state.remoteCallFailureTitle ?: \"通话连接失败\""))
        assertTrue(route.contains("onDismissRemoteCallFailure"))
    }

    @Test
    fun committedActivationExchangeCanRecoverAfterAResponseLoss() {
        val repository = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt",
        ).readText()
        val vault = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/CredentialVault.kt",
        ).readText()
        val policy = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/data/ActivationPollingPolicy.kt",
        ).readText()

        assertTrue(repository.contains("activationChallengeDisposition(activationStatus)"))
        assertTrue(repository.contains("status.optString(\"recoveryToken\")"))
        assertTrue(repository.contains("DeviceProofProtocol.exchangeRecoveryMessage"))
        assertTrue(repository.contains("exchangeBody.put(\"recoveryToken\", it)"))
        assertTrue(repository.contains("vault.savePendingDeviceActivation(null)"))
        assertTrue(vault.contains("pending-device-activation-v1"))
        assertTrue(policy.contains("\"CANCELLED\", \"EXPIRED\", \"ATTEMPTS_EXCEEDED\""))
        assertTrue(policy.contains("MAX_ACTIVATION_RECOVERY_CONFLICTS"))
    }

    @Test
    fun familyHangupReleasesLocalMediaBeforeWaitingForTheServer() {
        val viewModel = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt",
        ).readText()
        val logout = viewModel.substringAfter("fun logout()")
            .substringBefore("fun switchRole")
        val endCall = viewModel.substringAfter("fun endRemoteCall()")
            .substringBefore("fun cancelRemoteRequest")

        assertTrue(
            logout.indexOf("callCoordinator.disconnectFamily") in
                0 until logout.indexOf("repository.endFamilyRemoteSession"),
        )
        assertTrue(
            endCall.indexOf("callCoordinator.disconnectFamily") in
                0 until endCall.indexOf("repository.endFamilyRemoteSession"),
        )
    }

    @Test
    fun cancelledTelecomAnswerQueuesServerConvergenceOutsideTheTimedOutJob() {
        val coordinator = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/call/RemoteCallCoordinator.kt",
        ).readText().replace("\r\n", "\n")

        assertTrue(coordinator.contains("catch (cancelled: CancellationException)"))
        assertTrue(coordinator.contains("withContext(NonCancellable)"))
        assertTrue(coordinator.contains("runHandoffWithTerminalCompensation"))
        assertTrue(coordinator.contains("notifyServerAsynchronously = true"))
        assertTrue(
            coordinator.contains(
                "onNotificationCancelled = {\n                    enqueueServerTerminationCompensation",
            ),
        )
        assertTrue(coordinator.contains("withTimeoutOrNull(SERVER_TERMINATION_COMPENSATION_TIMEOUT_MILLIS)"))
    }
}
