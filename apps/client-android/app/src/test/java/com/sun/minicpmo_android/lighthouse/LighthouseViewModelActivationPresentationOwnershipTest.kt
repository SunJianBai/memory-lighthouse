package com.sun.minicpmo_android.lighthouse

import android.net.Uri
import androidx.lifecycle.viewModelScope
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaHandoffState
import com.sun.minicpmo_android.lighthouse.call.CoordinatedRemoteCallState
import com.sun.minicpmo_android.lighthouse.call.RemoteCallCoordinator
import com.sun.minicpmo_android.lighthouse.call.RemoteHeartbeatConnectionState
import com.sun.minicpmo_android.lighthouse.data.ActivationExchangeOutcome
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandRegistry
import com.sun.minicpmo_android.lighthouse.model.AppRole
import com.sun.minicpmo_android.lighthouse.model.CareRecipientView
import com.sun.minicpmo_android.lighthouse.model.CompanionBindingView
import com.sun.minicpmo_android.lighthouse.model.ConsentStateView
import com.sun.minicpmo_android.lighthouse.model.DeviceContextView
import com.sun.minicpmo_android.lighthouse.model.DeviceCredential
import com.sun.minicpmo_android.lighthouse.model.HouseholdView
import com.sun.minicpmo_android.lighthouse.model.PendingDeviceActivation
import com.sun.minicpmo_android.lighthouse.model.RoutineView
import com.sun.minicpmo_android.lighthouse.model.UserView
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkAll
import io.mockk.verify
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LighthouseViewModelActivationPresentationOwnershipTest {
    private val mainDispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(mainDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        unmockkAll()
    }

    @Test
    fun lateDynamicClaimSuccessAfterLogoutAndReloginCannotHijackNewFamilyPresentation() =
        runTest(mainDispatcher) {
            val lateClaim = CompletableDeferred<PendingDeviceActivation>()
            val fixture = fixture(lateClaim)
            try {
                fixture.signIn(this)
                fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
                runCurrent()

                fixture.viewModel.logout()
                advanceUntilIdle()
                fixture.viewModel.login("family", "password")
                advanceUntilIdle()

                assertFalse(
                    "an obsolete claim must not keep the newer login busy",
                    fixture.viewModel.uiState.value.busy,
                )

                lateClaim.complete(pending())
                runCurrent()

                val state = fixture.viewModel.uiState.value
                assertEquals(AppRole.FAMILY, state.role)
                assertEquals(true, state.signedIn)
                assertEquals(USER_ID, state.user?.id)
                assertNull(state.pendingDeviceActivation)
                assertNull(state.message)
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun lateDynamicClaimFailureAfterLogoutAndReloginCannotPublishErrorOrBusy() =
        runTest(mainDispatcher) {
            val lateClaim = CompletableDeferred<PendingDeviceActivation>()
            val fixture = fixture(lateClaim)
            try {
                fixture.signIn(this)
                fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
                runCurrent()

                fixture.viewModel.logout()
                advanceUntilIdle()
                fixture.viewModel.login("family", "password")
                advanceUntilIdle()

                assertFalse(fixture.viewModel.uiState.value.busy)

                lateClaim.completeExceptionally(IOException("old claim failed"))
                runCurrent()

                val state = fixture.viewModel.uiState.value
                assertEquals(AppRole.FAMILY, state.role)
                assertEquals(true, state.signedIn)
                assertNull(state.message)
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun lateQrClaimAfterLogoutAndReloginCannotSwitchTheNewFamilyRole() =
        runTest(mainDispatcher) {
            stubQrPayload()
            val lateClaim = CompletableDeferred<PendingDeviceActivation>()
            val fixture = fixture(lateClaim)
            try {
                fixture.signIn(this)
                fixture.viewModel.handleActivationQr(QR_PAYLOAD)
                runCurrent()

                fixture.viewModel.logout()
                advanceUntilIdle()
                fixture.viewModel.login("family", "password")
                advanceUntilIdle()

                lateClaim.complete(pending())
                runCurrent()

                val state = fixture.viewModel.uiState.value
                assertEquals(AppRole.FAMILY, state.role)
                assertEquals(true, state.signedIn)
                assertNull(state.pendingDeviceActivation)
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun secondClaimCannotReachRepositoryWhileFirstClaimIsInFlight() =
        runTest(mainDispatcher) {
            val lateClaim = CompletableDeferred<PendingDeviceActivation>()
            val fixture = fixture(lateClaim)
            try {
                fixture.signIn(this)
                fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
                runCurrent()

                fixture.viewModel.claimDynamicCode("PUBLIC2", "654321")
                runCurrent()

                coVerify(exactly = 1) {
                    fixture.repository.claimActivation(any(), any(), any())
                }
            } finally {
                fixture.close()
            }
        }

    @Test
    fun currentDynamicClaimStillPublishesPendingAndStartsRecovery() =
        runTest(mainDispatcher) {
            val fixture = fixture(CompletableDeferred(pending()))
            try {
                fixture.signIn(this)

                fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
                runCurrent()

                val state = fixture.viewModel.uiState.value
                assertEquals(CHALLENGE_ID, state.pendingDeviceActivation?.challengeId)
                assertEquals("设备已认领，请家属端批准后完成激活", state.message)
                assertNull(state.error)
                assertFalse(state.busy)
                coVerify(exactly = 1) {
                    fixture.repository.exchangeApprovedActivation(
                        match { it.challengeId == CHALLENGE_ID },
                    )
                }
            } finally {
                fixture.close()
            }
        }

    @Test
    fun currentQrClaimStillSwitchesToCompanionAndStartsRecovery() =
        runTest(mainDispatcher) {
            stubQrPayload()
            val fixture = fixture(CompletableDeferred(pending()))
            try {
                fixture.signIn(this)

                fixture.viewModel.handleActivationQr(QR_PAYLOAD)
                runCurrent()

                val state = fixture.viewModel.uiState.value
                assertEquals(AppRole.COMPANION, state.role)
                assertEquals(CHALLENGE_ID, state.pendingDeviceActivation?.challengeId)
                assertEquals("二维码已验证，请家属端批准", state.message)
                assertNull(state.error)
                assertFalse(state.busy)
                coVerify(exactly = 1) {
                    fixture.repository.exchangeApprovedActivation(
                        match { it.challengeId == CHALLENGE_ID },
                    )
                }
            } finally {
                fixture.close()
            }
        }

    @Test
    fun staleActivatedExchangeStillLocksTheDeviceExactlyOnce() =
        runTest(mainDispatcher) {
            val lateExchange = CompletableDeferred<ActivationExchangeOutcome>()
            val fixture = fixture(
                lateClaim = CompletableDeferred(pending()),
                lateExchange = lateExchange,
                exchangeIsNonCancellable = true,
                onlyFirstExchangeIsDeferred = true,
            )
            try {
                fixture.signIn(this)
                fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
                runCurrent()

                fixture.viewModel.logout()
                advanceUntilIdle()
                fixture.viewModel.login("family", "password")
                runCurrent()

                lateExchange.complete(ActivationExchangeOutcome.Activated(credential()))
                runCurrent()

                val state = fixture.viewModel.uiState.value
                assertEquals(AppRole.COMPANION, state.role)
                assertFalse(state.signedIn)
                assertEquals(true, state.deviceActivated)
                assertEquals(true, state.companionDeviceLocked)
                coVerify(exactly = 1) {
                    fixture.repository.revokeUserSessionForCompanionMode()
                }
            } finally {
                fixture.close()
            }
        }

    @Test
    fun staleTerminalExchangeCannotPublishItsErrorIntoTheNewLogin() =
        runTest(mainDispatcher) {
            val lateExchange = CompletableDeferred<ActivationExchangeOutcome>()
            val fixture = fixture(
                lateClaim = CompletableDeferred(pending()),
                lateExchange = lateExchange,
                exchangeIsNonCancellable = true,
                onlyFirstExchangeIsDeferred = true,
            )
            try {
                fixture.signIn(this)
                fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
                runCurrent()

                fixture.viewModel.logout()
                advanceUntilIdle()
                fixture.viewModel.login("family", "password")
                runCurrent()

                lateExchange.complete(
                    ActivationExchangeOutcome.Terminal(
                        status = "EXPIRED",
                        message = "old activation expired",
                    ),
                )
                runCurrent()
                advanceTimeBy(3_000)
                runCurrent()

                val state = fixture.viewModel.uiState.value
                assertEquals(AppRole.FAMILY, state.role)
                assertEquals(true, state.signedIn)
                assertNull(state.pendingDeviceActivation)
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun activatedDeviceCannotStartAnotherClaim() = runTest(mainDispatcher) {
        val fixture = fixture(
            lateClaim = CompletableDeferred(pending()),
            initialHasDeviceCredential = true,
        )
        try {
            fixture.signIn(this)

            fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
            runCurrent()

            coVerify(exactly = 0) {
                fixture.repository.claimActivation(any(), any(), any())
            }
            assertEquals("当前设备已完成激活，无需再次认领", fixture.viewModel.uiState.value.error)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun credentialWinsAndClearsPendingDuringStartupRecovery() = runTest(mainDispatcher) {
        val fixture = fixture(
            lateClaim = CompletableDeferred(pending()),
            initialPending = pending(),
            initialHasDeviceCredential = true,
        )
        try {
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(AppRole.COMPANION, state.role)
            assertEquals(true, state.companionDeviceLocked)
            assertNull(fixture.repository.pendingDeviceActivation())
            verify(atLeast = 1) {
                fixture.repository.abandonPendingDeviceActivation()
            }
        } finally {
            fixture.close()
        }
    }

    @Test
    fun pollCancellationDoesNotAbandonPendingActivation() =
        runTest(mainDispatcher) {
            val lateExchange = CompletableDeferred<ActivationExchangeOutcome>()
            val fixture = fixture(
                lateClaim = CompletableDeferred(pending()),
                lateExchange = lateExchange,
            )
            try {
                fixture.signIn(this)
                fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
                runCurrent()

                fixture.viewModel.logout()
                advanceUntilIdle()

                assertEquals(CHALLENGE_ID, fixture.repository.pendingDeviceActivation()?.challengeId)
                coVerify(exactly = 0) {
                    fixture.repository.abandonPendingDeviceActivation()
                }
            } finally {
                fixture.close()
            }
        }

    @Test
    fun credentialCommittedDuringLogoutCannotBeOverwrittenBySignedOutState() =
        runTest(mainDispatcher) {
            val lateExchange = CompletableDeferred<ActivationExchangeOutcome>()
            val lateLogout = CompletableDeferred<Unit>()
            val fixture = fixture(
                lateClaim = CompletableDeferred(pending()),
                lateExchange = lateExchange,
                exchangeIsNonCancellable = true,
                lateLogout = lateLogout,
            )
            try {
                fixture.signIn(this)
                fixture.viewModel.claimDynamicCode(PUBLIC_ID, DYNAMIC_CODE)
                runCurrent()

                fixture.viewModel.logout()
                runCurrent()
                lateExchange.complete(ActivationExchangeOutcome.Activated(credential()))
                runCurrent()
                lateLogout.complete(Unit)
                runCurrent()

                val state = fixture.viewModel.uiState.value
                assertEquals(AppRole.COMPANION, state.role)
                assertFalse(state.signedIn)
                assertEquals(true, state.deviceActivated)
                assertEquals(true, state.companionDeviceLocked)
                coVerify(exactly = 1) {
                    fixture.repository.revokeUserSessionForCompanionMode()
                }
            } finally {
                fixture.close()
            }
        }

    private fun fixture(
        lateClaim: CompletableDeferred<PendingDeviceActivation>,
        lateExchange: CompletableDeferred<ActivationExchangeOutcome>? = null,
        exchangeIsNonCancellable: Boolean = false,
        onlyFirstExchangeIsDeferred: Boolean = false,
        lateLogout: CompletableDeferred<Unit>? = null,
        initialPending: PendingDeviceActivation? = null,
        initialHasDeviceCredential: Boolean = false,
    ): Fixture {
        val repository = mockk<LighthouseRepository>(relaxed = true)
        var persistedPending: PendingDeviceActivation? = initialPending
        var hasDeviceCredential = initialHasDeviceCredential
        var exchangeCallCount = 0
        every { repository.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        every { repository.hasDeviceCredential() } answers { hasDeviceCredential }
        every { repository.pendingDeviceActivation() } answers { persistedPending }
        every { repository.abandonPendingDeviceActivation() } answers {
            persistedPending = null
        }
        coEvery { repository.restoreUser() } returns null
        coEvery { repository.login(any(), any()) } returns user()
        coEvery {
            repository.completeUserSessionRevocation(any(), any())
        } coAnswers { lateLogout?.await() ?: Unit }
        coEvery { repository.listHouseholds() } returns listOf(household())
        coEvery { repository.listRecipients(HOUSEHOLD_ID) } returns listOf(recipient())
        coEvery { repository.listBindings(HOUSEHOLD_ID) } returns emptyList<CompanionBindingView>()
        coEvery { repository.listHouseholdMembers(HOUSEHOLD_ID) } returns emptyList()
        coEvery { repository.listMemories(HOUSEHOLD_ID, RECIPIENT_ID) } returns emptyList()
        coEvery { repository.listRoutines(HOUSEHOLD_ID, RECIPIENT_ID) } returns
            emptyList<RoutineView>()
        coEvery {
            repository.listOccurrences(HOUSEHOLD_ID, RECIPIENT_ID, any(), any())
        } returns emptyList()
        coEvery { repository.listCareEvents(HOUSEHOLD_ID, RECIPIENT_ID) } returns emptyList()
        coEvery { repository.listFamilyTasks(HOUSEHOLD_ID, RECIPIENT_ID) } returns emptyList()
        coEvery { repository.listConsents(HOUSEHOLD_ID, RECIPIENT_ID) } returns
            emptyList<ConsentStateView>()
        coEvery { repository.claimActivation(any(), any(), any()) } coAnswers {
            lateClaim.await().also { persistedPending = it }
        }
        coEvery { repository.exchangeApprovedActivation(any()) } coAnswers {
            val callIndex = exchangeCallCount++
            val outcome = when {
                lateExchange == null -> ActivationExchangeOutcome.Waiting
                onlyFirstExchangeIsDeferred && callIndex > 0 ->
                    ActivationExchangeOutcome.Waiting
                exchangeIsNonCancellable -> withContext(NonCancellable) { lateExchange.await() }
                else -> lateExchange.await()
            }
            if (outcome is ActivationExchangeOutcome.Activated) {
                hasDeviceCredential = true
                persistedPending = null
            } else if (outcome is ActivationExchangeOutcome.Terminal) {
                persistedPending = null
            }
            outcome
        }
        coEvery { repository.getDeviceContext() } returns deviceContext()

        val callCoordinator = mockk<RemoteCallCoordinator>(relaxed = true)
        every { callCoordinator.state } returns MutableStateFlow(CoordinatedRemoteCallState())
        every { callCoordinator.liveCallState } returns MutableStateFlow(LiveCallState())
        every { callCoordinator.heartbeatConnectionState } returns
            MutableStateFlow<RemoteHeartbeatConnectionState?>(null)
        every { callCoordinator.companionMediaHandoffState } returns
            MutableStateFlow<CompanionMediaHandoffState>(CompanionMediaHandoffState.Idle)

        return Fixture(
            viewModel = LighthouseViewModel(
                repository = repository,
                callCoordinator = callCoordinator,
                remoteCallCommands = mockk<RemoteCallCommandRegistry>(relaxed = true),
            ),
            repository = repository,
        )
    }

    private data class Fixture(
        val viewModel: LighthouseViewModel,
        val repository: LighthouseRepository,
    ) {
        fun signIn(scope: TestScope) = with(scope) {
            advanceUntilIdle()
            viewModel.login("family", "password")
            advanceUntilIdle()
        }

        fun close() {
            viewModel.viewModelScope.cancel()
        }
    }

    private fun user() = UserView(
        id = USER_ID,
        displayName = "Family",
        status = "ACTIVE",
        primaryIdentity = "family",
        email = "family@example.com",
        emailVerified = true,
    )

    private fun household() = HouseholdView(
        id = HOUSEHOLD_ID,
        name = "Home",
        timezone = "Asia/Shanghai",
        status = "ACTIVE",
        roleCodes = listOf("OWNER"),
        version = 1,
    )

    private fun recipient() = CareRecipientView(
        id = RECIPIENT_ID,
        householdId = HOUSEHOLD_ID,
        name = "Recipient",
        preferredName = "Recipient",
        birthDate = null,
        timezone = "Asia/Shanghai",
        homeLabel = null,
        status = "ACTIVE",
        version = 1,
    )

    private fun pending() = PendingDeviceActivation(
        challengeId = CHALLENGE_ID,
        publicId = PUBLIC_ID,
        proofType = "DYNAMIC_CODE",
        proof = DYNAMIC_CODE,
    )

    private fun stubQrPayload() {
        mockkStatic(Uri::class)
        val uri = mockk<Uri>()
        every { Uri.parse(QR_PAYLOAD) } returns uri
        every { uri.scheme } returns "memory-lighthouse"
        every { uri.host } returns "activate"
        every { uri.getQueryParameter("publicId") } returns PUBLIC_ID
        every { uri.getQueryParameter("secret") } returns "qr-secret"
    }

    private fun credential() = DeviceCredential(
        credential = "device-credential",
        credentialId = "credential-1",
        credentialFamilyId = "family-1",
        bindingId = "binding-1",
        householdId = HOUSEHOLD_ID,
        recipientId = RECIPIENT_ID,
        expiresAt = "2027-08-25T00:00:00Z",
        accessToken = "access-token",
        accessTokenExpiresAt = "2026-08-25T01:00:00Z",
    )

    private fun deviceContext() = DeviceContextView(
        deviceId = "device-1",
        bindingId = "binding-1",
        householdId = HOUSEHOLD_ID,
        recipientId = RECIPIENT_ID,
        recipientName = "Recipient",
        timezone = "Asia/Shanghai",
        modelProvider = "OPENBMB",
        modelName = "MiniCPM-o 4.5",
        realtimeUrl = "wss://example.invalid/realtime",
        consentDecisions = emptyMap(),
    )

    private companion object {
        const val USER_ID = "user-1"
        const val HOUSEHOLD_ID = "household-1"
        const val RECIPIENT_ID = "recipient-1"
        const val CHALLENGE_ID = "challenge-1"
        const val PUBLIC_ID = "PUBLIC1"
        const val DYNAMIC_CODE = "123456"
        const val QR_PAYLOAD =
            "memory-lighthouse://activate?publicId=PUBLIC1&secret=qr-secret"
    }
}
