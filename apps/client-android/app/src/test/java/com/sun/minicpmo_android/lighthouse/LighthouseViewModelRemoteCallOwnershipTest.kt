package com.sun.minicpmo_android.lighthouse

import androidx.lifecycle.viewModelScope
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaHandoffState
import com.sun.minicpmo_android.lighthouse.call.CoordinatedRemoteCallState
import com.sun.minicpmo_android.lighthouse.call.RemoteCallCoordinator
import com.sun.minicpmo_android.lighthouse.call.RemoteHeartbeatConnectionState
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandPersistence
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandRegistry
import com.sun.minicpmo_android.lighthouse.model.CareRecipientView
import com.sun.minicpmo_android.lighthouse.model.CompanionBindingView
import com.sun.minicpmo_android.lighthouse.model.ConsentStateView
import com.sun.minicpmo_android.lighthouse.model.DeviceContextView
import com.sun.minicpmo_android.lighthouse.model.HouseholdView
import com.sun.minicpmo_android.lighthouse.model.RemoteJoinTicket
import com.sun.minicpmo_android.lighthouse.model.RemoteSessionView
import com.sun.minicpmo_android.lighthouse.model.RequestedRemoteMedia
import com.sun.minicpmo_android.lighthouse.model.RoutineView
import com.sun.minicpmo_android.lighthouse.model.UserView
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import io.mockk.clearMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean

@OptIn(ExperimentalCoroutinesApi::class)
class LighthouseViewModelRemoteCallOwnershipTest {
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
    fun lateJoinTicketCannotConnectAfterTheSessionStartsEnding() = runTest(mainDispatcher) {
        val joinA = CompletableDeferred<RemoteJoinTicket>()
        val endA = CompletableDeferred<Unit>()
        val fixture = fixture(joinA = joinA, endA = endA)
        try {
            fixture.signIn(this)
            fixture.request(this, SESSION_A, BINDING_A)

            fixture.viewModel.connectFamilyCall()
            runCurrent()
            fixture.viewModel.endRemoteCall()
            runCurrent()

            joinA.complete(joinTicket(SESSION_A))
            runCurrent()

            verify(exactly = 0) {
                fixture.callCoordinator.connectFamily(match { it.sessionId == SESSION_A })
            }
        } finally {
            endA.complete(Unit)
            runCurrent()
            fixture.close()
        }
    }

    @Test
    fun lateJoinTicketCannotConnectAfterTheSessionStartsCancelling() = runTest(mainDispatcher) {
        val joinA = CompletableDeferred<RemoteJoinTicket>()
        val cancelA = CompletableDeferred<Unit>()
        val fixture = fixture(joinA = joinA, cancelA = cancelA)
        try {
            fixture.signIn(this)
            fixture.request(this, SESSION_A, BINDING_A)

            fixture.viewModel.connectFamilyCall()
            runCurrent()
            fixture.viewModel.cancelRemoteRequest()
            runCurrent()

            joinA.complete(joinTicket(SESSION_A))
            runCurrent()

            verify(exactly = 0) {
                fixture.callCoordinator.connectFamily(match { it.sessionId == SESSION_A })
            }
        } finally {
            cancelA.complete(Unit)
            runCurrent()
            fixture.close()
        }
    }

    @Test
    fun lateJoinTicketCannotReplaceTheNewCurrentConnection() = runTest(mainDispatcher) {
        val joinA = CompletableDeferred<RemoteJoinTicket>()
        val fixture = fixture(joinA = joinA)
        try {
            fixture.signIn(this)
            fixture.request(this, SESSION_A, BINDING_A)
            fixture.viewModel.connectFamilyCall()
            runCurrent()

            fixture.request(this, SESSION_B, BINDING_B)
            fixture.viewModel.connectFamilyCall()
            runCurrent()

            verify(exactly = 1) {
                fixture.callCoordinator.connectFamily(match { it.sessionId == SESSION_B })
            }

            joinA.complete(joinTicket(SESSION_A))
            runCurrent()

            assertEquals(SESSION_B, fixture.viewModel.uiState.value.activeRemoteSession?.id)
            verify(exactly = 0) {
                fixture.callCoordinator.connectFamily(match { it.sessionId == SESSION_A })
            }
        } finally {
            fixture.close()
        }
    }

    @Test
    fun currentJoinTicketStillConnectsExactlyOnce() = runTest(mainDispatcher) {
        val joinA = CompletableDeferred(joinTicket(SESSION_A))
        val fixture = fixture(joinA = joinA)
        try {
            fixture.signIn(this)
            fixture.request(this, SESSION_A, BINDING_A)

            fixture.viewModel.connectFamilyCall()
            runCurrent()

            verify(exactly = 1) {
                fixture.callCoordinator.connectFamily(match { it.sessionId == SESSION_A })
            }
        } finally {
            fixture.close()
        }
    }

    @Test
    fun slowLogoutReleasesFamilyMediaBeforeTheNetworkCompletes() = runTest(mainDispatcher) {
        val lateRevocation = CompletableDeferred<Unit>()
        val fixture = fixture(
            joinA = CompletableDeferred(joinTicket(SESSION_A)),
            lateRevocation = lateRevocation,
        )
        try {
            fixture.signIn(this)
            fixture.request(this, SESSION_A, BINDING_A)

            fixture.viewModel.logout()
            runCurrent()

            verify(exactly = 1) {
                fixture.callCoordinator.disconnectFamily("signed_out")
            }
            coVerify(exactly = 0) {
                fixture.repository.endFamilyRemoteSession(HOUSEHOLD_ID, SESSION_A)
            }
            coVerify(exactly = 1) {
                fixture.repository.completeUserSessionRevocation(
                    any(),
                    match { it?.id == SESSION_A },
                )
            }
        } finally {
            lateRevocation.complete(Unit)
            advanceUntilIdle()
            fixture.close()
        }
    }

    @Test
    fun activatedDeviceLogoutStillEndsTheFamilyRemoteSession() = runTest(mainDispatcher) {
        val lateRevocation = CompletableDeferred<Unit>()
        val fixture = fixture(
            joinA = CompletableDeferred(joinTicket(SESSION_A)),
            lateRevocation = lateRevocation,
            hasDeviceCredential = true,
        )
        try {
            fixture.signIn(this)
            fixture.request(this, SESSION_A, BINDING_A)

            fixture.viewModel.logout()
            runCurrent()

            verify(exactly = 1) {
                fixture.callCoordinator.disconnectFamily("signed_out")
            }
            coVerify(exactly = 1) {
                fixture.repository.completeUserSessionRevocation(
                    any(),
                    match { it?.id == SESSION_A },
                )
            }
        } finally {
            lateRevocation.complete(Unit)
            advanceUntilIdle()
            fixture.close()
        }
    }

    @Test
    fun logoutUsesTheCurrentDeviceCredentialStateAfterRevocationCompletes() =
        runTest(mainDispatcher) {
            val lateRevocation = CompletableDeferred<Unit>()
            val fixture = fixture(
                joinA = CompletableDeferred(joinTicket(SESSION_A)),
                lateRevocation = lateRevocation,
                hasDeviceCredential = true,
            )
            try {
                fixture.signIn(this)
                clearMocks(fixture.callCoordinator, answers = false)

                fixture.viewModel.logout()
                runCurrent()
                fixture.deviceCredentialPresent.set(false)
                lateRevocation.complete(Unit)
                advanceUntilIdle()

                assertEquals(false, fixture.viewModel.uiState.value.deviceActivated)
                assertEquals(false, fixture.viewModel.uiState.value.companionDeviceLocked)
                verify(exactly = 0) {
                    fixture.callCoordinator.ensureCompanionDiscoveryRunning()
                }
            } finally {
                fixture.close()
            }
        }

    private fun fixture(
        joinA: CompletableDeferred<RemoteJoinTicket>,
        endA: CompletableDeferred<Unit>? = null,
        cancelA: CompletableDeferred<Unit>? = null,
        lateRevocation: CompletableDeferred<Unit>? = null,
        hasDeviceCredential: Boolean = false,
    ): Fixture {
        val repository = mockk<LighthouseRepository>(relaxed = true)
        every { repository.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        val deviceCredentialPresent = AtomicBoolean(hasDeviceCredential)
        every { repository.hasDeviceCredential() } answers { deviceCredentialPresent.get() }
        every { repository.pendingDeviceActivation() } returns null
        coEvery { repository.restoreUser() } returns null
        coEvery { repository.login(any(), any()) } returns user()
        coEvery {
            repository.completeUserSessionRevocation(any(), any())
        } coAnswers { lateRevocation?.await() ?: Unit }
        coEvery { repository.getDeviceContext() } returns deviceContext()
        coEvery { repository.listHouseholds() } returns listOf(household())
        coEvery { repository.listRecipients(HOUSEHOLD_ID) } returns listOf(recipient())
        coEvery { repository.listBindings(HOUSEHOLD_ID) } returns listOf(
            binding(BINDING_A),
            binding(BINDING_B),
        )
        coEvery { repository.listHouseholdMembers(HOUSEHOLD_ID) } returns emptyList()
        coEvery { repository.listMemories(HOUSEHOLD_ID, RECIPIENT_ID) } returns emptyList()
        coEvery { repository.listRoutines(HOUSEHOLD_ID, RECIPIENT_ID) } returns emptyList<RoutineView>()
        coEvery {
            repository.listOccurrences(HOUSEHOLD_ID, RECIPIENT_ID, any(), any())
        } returns emptyList()
        coEvery { repository.listCareEvents(HOUSEHOLD_ID, RECIPIENT_ID) } returns emptyList()
        coEvery { repository.listFamilyTasks(HOUSEHOLD_ID, RECIPIENT_ID) } returns emptyList()
        coEvery {
            repository.listConsents(HOUSEHOLD_ID, RECIPIENT_ID)
        } returns emptyList<ConsentStateView>()
        coEvery {
            repository.requestRemoteSession(HOUSEHOLD_ID, BINDING_A, any(), any())
        } returns remoteSession(SESSION_A, BINDING_A)
        coEvery {
            repository.requestRemoteSession(HOUSEHOLD_ID, BINDING_B, any(), any())
        } returns remoteSession(SESSION_B, BINDING_B)
        coEvery { repository.familyJoinTicket(HOUSEHOLD_ID, SESSION_A) } coAnswers {
            joinA.await()
        }
        coEvery { repository.familyJoinTicket(HOUSEHOLD_ID, SESSION_B) } returns
            joinTicket(SESSION_B)
        coEvery { repository.endFamilyRemoteSession(HOUSEHOLD_ID, SESSION_A) } coAnswers {
            endA?.await() ?: Unit
        }
        coEvery { repository.cancelFamilyRemoteSession(HOUSEHOLD_ID, SESSION_A) } coAnswers {
            cancelA?.await() ?: Unit
        }

        val callCoordinator = mockk<RemoteCallCoordinator>(relaxed = true)
        every { callCoordinator.state } returns MutableStateFlow(CoordinatedRemoteCallState())
        every { callCoordinator.liveCallState } returns MutableStateFlow(LiveCallState())
        every { callCoordinator.heartbeatConnectionState } returns
            MutableStateFlow<RemoteHeartbeatConnectionState?>(null)
        every { callCoordinator.companionMediaHandoffState } returns
            MutableStateFlow<CompanionMediaHandoffState>(CompanionMediaHandoffState.Idle)

        var nextCommandId = 0
        return Fixture(
            viewModel = LighthouseViewModel(
                repository = repository,
                callCoordinator = callCoordinator,
                remoteCallCommands = RemoteCallCommandRegistry(
                    persistence = MemoryRemoteCallCommandPersistence(),
                    createId = { "command-${nextCommandId++}" },
                ),
            ),
            callCoordinator = callCoordinator,
            repository = repository,
            deviceCredentialPresent = deviceCredentialPresent,
        )
    }

    private data class Fixture(
        val viewModel: LighthouseViewModel,
        val callCoordinator: RemoteCallCoordinator,
        val repository: LighthouseRepository,
        val deviceCredentialPresent: AtomicBoolean,
    ) {
        fun signIn(scope: TestScope) = with(scope) {
            advanceUntilIdle()
            viewModel.login("family", "password")
            advanceUntilIdle()
        }

        fun request(scope: TestScope, sessionId: String, bindingId: String) = with(scope) {
            viewModel.requestRemoteCall(bindingId)
            runCurrent()
            assertEquals(sessionId, viewModel.uiState.value.activeRemoteSession?.id)
        }

        fun close() {
            viewModel.viewModelScope.cancel()
        }
    }

    private class MemoryRemoteCallCommandPersistence : RemoteCallCommandPersistence {
        private var value: String? = null

        override fun read(): String? = value

        override fun write(value: String?) {
            this.value = value
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

    private fun binding(id: String) = CompanionBindingView(
        id = id,
        deviceId = "device-$id",
        householdId = HOUSEHOLD_ID,
        recipientId = RECIPIENT_ID,
        displayName = id,
        status = "ACTIVE",
        version = 1,
    )

    private fun remoteSession(id: String, bindingId: String) = RemoteSessionView(
        id = id,
        householdId = HOUSEHOLD_ID,
        recipientId = RECIPIENT_ID,
        bindingId = bindingId,
        status = "ACCEPTED",
        media = RequestedRemoteMedia(),
        requestedAt = "2026-08-25T00:00:00Z",
        acceptedAt = "2026-08-25T00:00:01Z",
        connectedAt = null,
        endedAt = null,
        endReason = null,
    )

    private fun deviceContext() = DeviceContextView(
        deviceId = "device-1",
        bindingId = BINDING_A,
        householdId = HOUSEHOLD_ID,
        recipientId = RECIPIENT_ID,
        recipientName = "Recipient",
        timezone = "Asia/Shanghai",
        modelProvider = "OPENBMB",
        modelName = "MiniCPM-o 4.5",
        realtimeUrl = "wss://example.invalid/realtime",
        consentDecisions = emptyMap(),
    )

    private fun joinTicket(sessionId: String) = RemoteJoinTicket(
        sessionId = sessionId,
        ticketId = "ticket-$sessionId",
        url = "wss://livekit.example.invalid",
        token = "token-$sessionId",
        expiresAt = "2026-08-25T00:01:00Z",
        media = RequestedRemoteMedia(),
        recording = false,
        transcription = false,
    )

    private companion object {
        const val USER_ID = "user-1"
        const val HOUSEHOLD_ID = "household-1"
        const val RECIPIENT_ID = "recipient-1"
        const val BINDING_A = "binding-a"
        const val BINDING_B = "binding-b"
        const val SESSION_A = "session-a"
        const val SESSION_B = "session-b"

    }
}
