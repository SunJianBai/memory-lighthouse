package com.sun.minicpmo_android.lighthouse

import androidx.lifecycle.viewModelScope
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaHandoffState
import com.sun.minicpmo_android.lighthouse.call.CoordinatedRemoteCallState
import com.sun.minicpmo_android.lighthouse.call.RemoteCallCoordinator
import com.sun.minicpmo_android.lighthouse.call.RemoteHeartbeatConnectionState
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandRegistry
import com.sun.minicpmo_android.lighthouse.model.ActivationApprovalDetails
import com.sun.minicpmo_android.lighthouse.model.ActivationApprovalDevice
import com.sun.minicpmo_android.lighthouse.model.ActivationPresentation
import com.sun.minicpmo_android.lighthouse.model.CareAuthorityInput
import com.sun.minicpmo_android.lighthouse.model.CareAuthorityView
import com.sun.minicpmo_android.lighthouse.model.CareRecipientView
import com.sun.minicpmo_android.lighthouse.model.CompanionBindingView
import com.sun.minicpmo_android.lighthouse.model.ConsentStateView
import com.sun.minicpmo_android.lighthouse.model.HouseholdMemberView
import com.sun.minicpmo_android.lighthouse.model.HouseholdView
import com.sun.minicpmo_android.lighthouse.model.MemoryInput
import com.sun.minicpmo_android.lighthouse.model.MemoryRevisionView
import com.sun.minicpmo_android.lighthouse.model.MemoryView
import com.sun.minicpmo_android.lighthouse.model.RoutineView
import com.sun.minicpmo_android.lighthouse.model.UserView
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LighthouseViewModelFamilyMutationOwnershipTest {
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
    fun lateMemoryCreateFromRecipientADoesNotPublishIntoRecipientB() =
        runTest(mainDispatcher) {
            val lateMemory = CompletableDeferred<MemoryView>()
            val fixture = fixture(lateMemory)
            try {
                fixture.signIn(this)

                fixture.viewModel.createMemory(memoryInput())
                runCurrent()
                fixture.viewModel.selectRecipient(RECIPIENT_B)
                advanceUntilIdle()

                assertEquals(RECIPIENT_B, fixture.viewModel.uiState.value.selectedRecipientId)
                assertFalse(
                    "recipient A work must not keep recipient B visibly busy",
                    fixture.viewModel.uiState.value.busy,
                )

                lateMemory.complete(memory("memory-a", RECIPIENT_A))
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals(RECIPIENT_B, state.selectedRecipientId)
                assertEquals(emptyList<String>(), state.memories.map { it.id })
                assertNull(state.message)
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun lateMemoryFailureFromRecipientADoesNotPublishIntoRecipientB() =
        runTest(mainDispatcher) {
            val lateMemory = CompletableDeferred<MemoryView>()
            val fixture = fixture(lateMemory)
            try {
                fixture.signIn(this)

                fixture.viewModel.createMemory(memoryInput())
                runCurrent()
                fixture.viewModel.selectRecipient(RECIPIENT_B)
                advanceUntilIdle()

                lateMemory.completeExceptionally(IOException("recipient A failed"))
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals(RECIPIENT_B, state.selectedRecipientId)
                assertEquals(emptyList<String>(), state.memories.map { it.id })
                assertNull(state.message)
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun currentMemorySuccessStillPublishesAndReconciles() = runTest(mainDispatcher) {
        val lateMemory = CompletableDeferred<MemoryView>()
        val fixture = fixture(lateMemory)
        try {
            fixture.signIn(this)

            fixture.viewModel.createMemory(memoryInput())
            runCurrent()
            lateMemory.complete(memory("memory-current", RECIPIENT_A))
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(RECIPIENT_A, state.selectedRecipientId)
            assertEquals(listOf("memory-current"), state.memories.map { it.id })
            assertEquals("记忆已保存", state.message)
            assertNull(state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun currentMemoryFailureRemainsVisibleAfterSilentReconciliation() =
        runTest(mainDispatcher) {
            val lateMemory = CompletableDeferred<MemoryView>()
            val fixture = fixture(lateMemory)
            try {
                fixture.signIn(this)

                fixture.viewModel.createMemory(memoryInput())
                runCurrent()
                lateMemory.completeExceptionally(IOException("current write failed"))
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals(RECIPIENT_A, state.selectedRecipientId)
                assertEquals(emptyList<String>(), state.memories.map { it.id })
                assertEquals("current write failed", state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun oldMutationCannotReviveAfterSameUserLogsOutAndBackIn() =
        runTest(mainDispatcher) {
            val lateMemory = CompletableDeferred<MemoryView>()
            val fixture = fixture(lateMemory)
            try {
                fixture.signIn(this)
                fixture.viewModel.createMemory(memoryInput())
                runCurrent()

                fixture.viewModel.logout()
                advanceUntilIdle()
                fixture.viewModel.login("family", "password")
                advanceUntilIdle()

                lateMemory.complete(memory("memory-old-session", RECIPIENT_A))
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals(RECIPIENT_A, state.selectedRecipientId)
                assertEquals(emptyList<String>(), state.memories.map { it.id })
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun staleMutationStillSignsOutItsActiveFamilySession() = runTest(mainDispatcher) {
        val lateMemory = CompletableDeferred<MemoryView>()
        val fixture = fixture(lateMemory)
        try {
            fixture.signIn(this)
            fixture.viewModel.createMemory(memoryInput())
            runCurrent()
            fixture.viewModel.selectRecipient(RECIPIENT_B)
            advanceUntilIdle()

            lateMemory.completeExceptionally(signedOutError())
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertFalse(state.signedIn)
            assertNull(state.user)
            assertNull(state.selectedHouseholdId)
            assertEquals("登录状态已失效", state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun signedOutFromAnOldSessionCannotTerminateANewerLogin() = runTest(mainDispatcher) {
        val lateMemory = CompletableDeferred<MemoryView>()
        val fixture = fixture(lateMemory)
        try {
            fixture.signIn(this)
            fixture.viewModel.createMemory(memoryInput())
            runCurrent()

            fixture.viewModel.logout()
            advanceUntilIdle()
            fixture.viewModel.login("family", "password")
            advanceUntilIdle()

            lateMemory.completeExceptionally(signedOutError())
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(true, state.signedIn)
            assertEquals(USER_ID, state.user?.id)
            assertEquals(RECIPIENT_A, state.selectedRecipientId)
            assertNull(state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun signedOutDuringMutationReconciliationTerminatesTheActiveSession() =
        runTest(mainDispatcher) {
            val updated = authority(version = 2, accessLevel = "MANAGE")
            val fixture = fixture(
                lateMemory = CompletableDeferred(),
                authorityUpdate = updated,
                careAuthorityReconcileFailure = signedOutError(),
            )
            try {
                fixture.signIn(this)

                fixture.viewModel.putCareAuthority(
                    memberId = MEMBER_ID,
                    input = authorityInput(version = 1),
                    currentPassword = "password",
                )
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertFalse(state.signedIn)
                assertNull(state.user)
                assertNull(state.selectedHouseholdId)
                assertEquals("登录状态已失效", state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun careAuthorityMutationSupersedesAnOlderAuthorityRead() = runTest(mainDispatcher) {
        val lateMemory = CompletableDeferred<MemoryView>()
        val lateAuthorities = CompletableDeferred<List<CareAuthorityView>>()
        val repositoryState = defaultRepositoryState().apply {
            careAuthorities = listOf(authority(version = 1, accessLevel = "VIEW"))
        }
        val updated = authority(version = 2, accessLevel = "MANAGE")
        val fixture = fixture(
            lateMemory = lateMemory,
            repositoryState = repositoryState,
            firstCareAuthorities = lateAuthorities,
            authorityUpdate = updated,
        )
        try {
            fixture.signIn(this)

            fixture.viewModel.loadCareAuthorities()
            runCurrent()
            fixture.viewModel.putCareAuthority(
                memberId = MEMBER_ID,
                input = authorityInput(version = 1),
                currentPassword = "password",
            )
            advanceUntilIdle()

            assertEquals(listOf(2), fixture.viewModel.uiState.value.careAuthorities.map { it.version })
            assertFalse(
                "the superseded read must not keep the current workspace busy",
                fixture.viewModel.uiState.value.busy,
            )

            lateAuthorities.complete(listOf(authority(version = 1, accessLevel = "VIEW")))
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(listOf(2), state.careAuthorities.map { it.version })
            assertEquals("Member 的照护权限已更新", state.message)
            assertNull(state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun automaticHouseholdFallbackClearsActivationPresentation() = runTest(mainDispatcher) {
        val repositoryState = defaultRepositoryState().apply {
            households = listOf(household(HOUSEHOLD_ID), household(HOUSEHOLD_B))
            recipientsByHousehold[HOUSEHOLD_B] = listOf(recipient(RECIPIENT_B, HOUSEHOLD_B))
        }
        val fixture = fixture(
            lateMemory = CompletableDeferred(),
            repositoryState = repositoryState,
        )
        try {
            fixture.signIn(this)
            fixture.showActivation()

            repositoryState.households = listOf(household(HOUSEHOLD_B))
            fixture.viewModel.refresh()
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(HOUSEHOLD_B, state.selectedHouseholdId)
            assertEquals(RECIPIENT_B, state.selectedRecipientId)
            assertNull(state.activation)
            assertNull(state.activationApprovalDetails)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun automaticRecipientFallbackClearsActivationPresentation() = runTest(mainDispatcher) {
        val repositoryState = defaultRepositoryState()
        val fixture = fixture(
            lateMemory = CompletableDeferred(),
            repositoryState = repositoryState,
        )
        try {
            fixture.signIn(this)
            fixture.showActivation()

            repositoryState.recipientsByHousehold[HOUSEHOLD_ID] =
                listOf(recipient(RECIPIENT_B))
            fixture.viewModel.refresh()
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(HOUSEHOLD_ID, state.selectedHouseholdId)
            assertEquals(RECIPIENT_B, state.selectedRecipientId)
            assertNull(state.activation)
            assertNull(state.activationApprovalDetails)
        } finally {
            fixture.close()
        }
    }

    private fun fixture(
        lateMemory: CompletableDeferred<MemoryView>,
        repositoryState: RepositoryState = defaultRepositoryState(),
        firstCareAuthorities: CompletableDeferred<List<CareAuthorityView>>? = null,
        authorityUpdate: CareAuthorityView? = null,
        careAuthorityReconcileFailure: Throwable? = null,
    ): Fixture {
        val repository = mockk<LighthouseRepository>(relaxed = true)
        val storedMemories = mutableMapOf<String, List<MemoryView>>()
        var careAuthorityReadCount = 0
        every { repository.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        every { repository.hasDeviceCredential() } returns false
        every { repository.pendingDeviceActivation() } returns null
        coEvery { repository.restoreUser() } returns null
        coEvery { repository.login(any(), any()) } returns user()
        coEvery { repository.listHouseholds() } coAnswers { repositoryState.households }
        coEvery { repository.listRecipients(any()) } coAnswers {
            repositoryState.recipientsByHousehold[firstArg()].orEmpty()
        }
        coEvery { repository.listBindings(any()) } returns emptyList<CompanionBindingView>()
        coEvery { repository.listHouseholdMembers(any()) } coAnswers {
            repositoryState.membersByHousehold[firstArg()].orEmpty()
        }
        coEvery { repository.listMemories(any(), any()) } coAnswers {
            storedMemories[secondArg()] ?: emptyList()
        }
        coEvery { repository.listRoutines(any(), any()) } returns emptyList<RoutineView>()
        coEvery {
            repository.listOccurrences(any(), any(), any(), any())
        } returns emptyList()
        coEvery { repository.listCareEvents(any(), any()) } returns emptyList()
        coEvery { repository.listFamilyTasks(any(), any()) } returns emptyList()
        coEvery { repository.listConsents(any(), any()) } returns emptyList<ConsentStateView>()
        coEvery {
            repository.createMemory(HOUSEHOLD_ID, RECIPIENT_A, any())
        } coAnswers {
            lateMemory.await().also { created ->
                storedMemories[RECIPIENT_A] =
                    (storedMemories[RECIPIENT_A].orEmpty() + created).distinctBy { it.id }
            }
        }
        coEvery { repository.listCareAuthorities(any(), any()) } coAnswers {
            val readIndex = careAuthorityReadCount++
            if (readIndex == 0 && firstCareAuthorities != null) {
                firstCareAuthorities.await()
            } else if (careAuthorityReconcileFailure != null) {
                throw careAuthorityReconcileFailure
            } else {
                repositoryState.careAuthorities
            }
        }
        coEvery {
            repository.putCareAuthority(any(), any(), any(), any(), any())
        } coAnswers {
            checkNotNull(authorityUpdate).also {
                repositoryState.careAuthorities = listOf(it)
            }
        }
        coEvery { repository.createActivationChallenge(any(), any()) } returns activation()
        coEvery { repository.activationApprovalDetails(any()) } returns activationApproval()

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
            scope = null,
        )
    }

    private data class Fixture(
        val viewModel: LighthouseViewModel,
        private var scope: TestScope?,
    ) {
        fun signIn(scope: TestScope) {
            this.scope = scope
            scope.advanceUntilIdle()
            viewModel.login("family", "password")
            scope.advanceUntilIdle()
            assertEquals(RECIPIENT_A, viewModel.uiState.value.selectedRecipientId)
        }

        fun showActivation() {
            val currentScope = checkNotNull(scope)
            viewModel.createActivation(RECIPIENT_A)
            currentScope.advanceUntilIdle()
            viewModel.loadActivationApprovalDetails(CHALLENGE_ID)
            currentScope.advanceUntilIdle()
            assertEquals(CHALLENGE_ID, viewModel.uiState.value.activation?.challengeId)
            assertEquals(
                CHALLENGE_ID,
                viewModel.uiState.value.activationApprovalDetails?.challengeId,
            )
        }

        fun close() {
            viewModel.viewModelScope.cancel()
        }
    }

    private class RepositoryState(
        var households: List<HouseholdView>,
        val recipientsByHousehold: MutableMap<String, List<CareRecipientView>>,
        val membersByHousehold: MutableMap<String, List<HouseholdMemberView>>,
        var careAuthorities: List<CareAuthorityView>,
    )

    private fun defaultRepositoryState() = RepositoryState(
        households = listOf(household()),
        recipientsByHousehold = mutableMapOf(
            HOUSEHOLD_ID to listOf(recipient(RECIPIENT_A), recipient(RECIPIENT_B)),
        ),
        membersByHousehold = mutableMapOf(
            HOUSEHOLD_ID to listOf(member()),
        ),
        careAuthorities = emptyList(),
    )

    private fun user() = UserView(
        id = USER_ID,
        displayName = "Family",
        status = "ACTIVE",
        primaryIdentity = "family",
        email = "family@example.com",
        emailVerified = true,
    )

    private fun household(id: String = HOUSEHOLD_ID) = HouseholdView(
        id = id,
        name = "Home",
        timezone = "Asia/Shanghai",
        status = "ACTIVE",
        roleCodes = listOf("OWNER"),
        version = 1,
    )

    private fun member() = HouseholdMemberView(
        id = MEMBER_ID,
        householdId = HOUSEHOLD_ID,
        userId = "member-user",
        displayName = "Member",
        status = "ACTIVE",
        roleCodes = listOf("CAREGIVER"),
        joinedAt = "2026-08-25T00:00:00Z",
        version = 1,
    )

    private fun recipient(
        id: String,
        householdId: String = HOUSEHOLD_ID,
    ) = CareRecipientView(
        id = id,
        householdId = householdId,
        name = id,
        preferredName = id,
        birthDate = null,
        timezone = "Asia/Shanghai",
        homeLabel = null,
        status = "ACTIVE",
        version = 1,
    )

    private fun authority(version: Int, accessLevel: String) = CareAuthorityView(
        id = "authority-1",
        householdId = HOUSEHOLD_ID,
        recipientId = RECIPIENT_A,
        memberId = MEMBER_ID,
        userId = "member-user",
        displayName = "Member",
        relationshipLabel = "家属",
        accessLevel = accessLevel,
        canManageProfile = true,
        canManageConsent = true,
        canManageRoutine = true,
        canViewEvents = true,
        canViewConversation = true,
        canActivateDevice = true,
        canRemoteCall = true,
        receiveNotifications = true,
        contactPriority = 1,
        status = "ACTIVE",
        version = version,
    )

    private fun authorityInput(version: Int) = CareAuthorityInput(
        relationshipLabel = "家属",
        accessLevel = "MANAGE",
        canManageProfile = true,
        canManageConsent = true,
        canManageRoutine = true,
        canViewEvents = true,
        canViewConversation = true,
        canActivateDevice = true,
        canRemoteCall = true,
        receiveNotifications = true,
        contactPriority = 1,
        status = "ACTIVE",
        version = version,
    )

    private fun activation() = ActivationPresentation(
        challengeId = CHALLENGE_ID,
        publicId = "public-1",
        dynamicCode = "123456",
        qrPayload = "activation-payload",
        expiresAt = "2026-08-25T01:00:00Z",
    )

    private fun activationApproval() = ActivationApprovalDetails(
        challengeId = CHALLENGE_ID,
        claimedAt = "2026-08-25T00:00:00Z",
        claimNetworkSource = "127.0.0.1",
        claimSnapshotToken = "snapshot-token",
        device = ActivationApprovalDevice(
            platform = "ANDROID",
            installationKeyAlgorithm = "EC_P256",
            manufacturer = "Google",
            model = "Emulator",
            osVersion = "16",
            appVersion = "1.0.3",
            keyFingerprintSuffix = "ABCD",
        ),
    )

    private fun signedOutError() = LighthouseApiException(
        status = 401,
        code = "SIGNED_OUT",
        message = "登录状态已失效",
    )

    private fun memoryInput() = MemoryInput(
        kind = "STORY",
        title = "A memory",
        content = "Only recipient A owns this memory",
        sensitivity = "HOUSEHOLD",
    )

    private fun memory(id: String, recipientId: String) = MemoryView(
        id = id,
        householdId = HOUSEHOLD_ID,
        recipientId = recipientId,
        kind = "STORY",
        title = "A memory",
        sensitivity = "HOUSEHOLD",
        verificationStatus = "FAMILY_REPORTED",
        status = "ACTIVE",
        currentRevision = MemoryRevisionView(
            id = "revision-$id",
            revisionNo = 1,
            content = "Only recipient A owns this memory",
            source = "FAMILY",
            changeReason = null,
            createdAt = "2026-08-25T00:00:00Z",
        ),
        updatedAt = "2026-08-25T00:00:00Z",
        version = 1,
    )

    private companion object {
        const val USER_ID = "user-1"
        const val HOUSEHOLD_ID = "household-1"
        const val HOUSEHOLD_B = "household-2"
        const val RECIPIENT_A = "recipient-a"
        const val RECIPIENT_B = "recipient-b"
        const val MEMBER_ID = "member-1"
        const val CHALLENGE_ID = "challenge-1"
    }
}
