package com.sun.minicpmo_android.lighthouse

import androidx.lifecycle.viewModelScope
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaHandoffState
import com.sun.minicpmo_android.lighthouse.call.CoordinatedRemoteCallState
import com.sun.minicpmo_android.lighthouse.call.RemoteCallCoordinator
import com.sun.minicpmo_android.lighthouse.call.RemoteHeartbeatConnectionState
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandRegistry
import com.sun.minicpmo_android.lighthouse.model.UserView
import com.sun.minicpmo_android.lighthouse.model.AppRole
import com.sun.minicpmo_android.lighthouse.model.DeviceContextView
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import io.mockk.coEvery
import io.mockk.coVerify
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
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LighthouseViewModelAuthenticationOwnershipTest {
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
    fun olderLoginFailureCannotPolluteANewerSuccessfulLogin() = runTest(mainDispatcher) {
        val olderLogin = CompletableDeferred<UserView>()
        val newerLogin = CompletableDeferred<UserView>()
        val fixture = fixture(olderLogin, newerLogin)
        try {
            advanceUntilIdle()
            fixture.viewModel.login("older", "password")
            runCurrent()
            fixture.viewModel.login("newer", "password")
            runCurrent()

            newerLogin.complete(user("newer"))
            advanceUntilIdle()
            olderLogin.completeExceptionally(IOException("旧登录失败"))
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals("newer-user", state.user?.id)
            assertNull(state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun lateLoginSuccessCannotSignTheScreenBackInAfterLogout() = runTest(mainDispatcher) {
        val olderLogin = CompletableDeferred<UserView>()
        val fixture = fixture(olderLogin, CompletableDeferred())
        try {
            advanceUntilIdle()
            fixture.viewModel.login("older", "password")
            runCurrent()
            fixture.viewModel.logout()
            advanceUntilIdle()

            olderLogin.complete(user("older"))
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertFalse(state.signedIn)
            assertNull(state.user)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun oldEmailVerificationRequestCannotPublishIntoANewerAccount() = runTest(mainDispatcher) {
        val verification = CompletableDeferred<Unit>()
        val fixture = fixture(
            olderLogin = CompletableDeferred(user("older")),
            newerLogin = CompletableDeferred(user("newer")),
            verificationRequest = verification,
        )
        try {
            advanceUntilIdle()
            fixture.viewModel.login("older", "password")
            advanceUntilIdle()
            fixture.viewModel.requestEmailVerification()
            runCurrent()
            fixture.viewModel.logout()
            advanceUntilIdle()
            fixture.viewModel.login("newer", "password")
            advanceUntilIdle()

            verification.complete(Unit)
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals("newer-user", state.user?.id)
            assertNull(state.message)
            assertFalse(state.emailVerificationPromptVisible)
            coVerify(exactly = 0) { fixture.repository.getMe() }
        } finally {
            fixture.close()
        }
    }

    @Test
    fun oldEmailVerificationConfirmationCannotPublishIntoANewerAccount() =
        runTest(mainDispatcher) {
            val confirmation = CompletableDeferred<Unit>()
            val fixture = fixture(
                olderLogin = CompletableDeferred(user("older")),
                newerLogin = CompletableDeferred(user("newer")),
                verificationConfirmation = confirmation,
            )
            try {
                advanceUntilIdle()
                fixture.viewModel.login("older", "password")
                advanceUntilIdle()
                fixture.viewModel.confirmEmailVerification("older@example.com", "123456")
                runCurrent()
                fixture.viewModel.logout()
                advanceUntilIdle()
                fixture.viewModel.login("newer", "password")
                advanceUntilIdle()

                confirmation.complete(Unit)
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals("newer-user", state.user?.id)
                assertNull(state.message)
                assertFalse(state.emailVerificationPromptVisible)
                coVerify(exactly = 0) { fixture.repository.getMe() }
            } finally {
                fixture.close()
            }
        }

    @Test
    fun staleCompanionLockTaskCannotKeepANewFamilyLoginBusy() = runTest(mainDispatcher) {
        val lateRevoke = CompletableDeferred<Unit>()
        val fixture = fixture(
            olderLogin = CompletableDeferred(user("older")),
            newerLogin = CompletableDeferred(user("newer")),
            hasDeviceCredential = true,
            lateRevoke = lateRevoke,
        )
        try {
            advanceUntilIdle()
            fixture.viewModel.login("older", "password")
            advanceUntilIdle()
            fixture.viewModel.switchRole(AppRole.COMPANION)
            runCurrent()
            fixture.viewModel.requireFamilyAuthentication()
            fixture.viewModel.login("newer", "password")
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals("newer-user", state.user?.id)
            assertFalse(state.busy)
        } finally {
            lateRevoke.complete(Unit)
            advanceUntilIdle()
            fixture.close()
        }
    }

    @Test
    fun olderRegistrationFailureCannotPolluteANewerLogin() = runTest(mainDispatcher) {
        val registration = CompletableDeferred<UserView>()
        val fixture = fixture(
            olderLogin = CompletableDeferred(user("older")),
            newerLogin = CompletableDeferred(user("newer")),
            registration = registration,
        )
        try {
            advanceUntilIdle()
            fixture.viewModel.register(
                email = "older@example.com",
                username = "older",
                password = "password",
                displayName = "Older",
            )
            runCurrent()
            fixture.viewModel.login("newer", "password")
            advanceUntilIdle()

            registration.completeExceptionally(IOException("旧注册失败"))
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals("newer-user", state.user?.id)
            assertNull(state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun normalRegistrationPublishesTheVerificationPrompt() = runTest(mainDispatcher) {
        val fixture = fixture(
            olderLogin = CompletableDeferred(user("older")),
            newerLogin = CompletableDeferred(user("newer")),
            registration = CompletableDeferred(
                user("registered").copy(emailVerified = false),
            ),
        )
        try {
            advanceUntilIdle()
            fixture.viewModel.register(
                email = "registered@example.com",
                username = "registered",
                password = "password",
                displayName = "Registered",
            )
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals("registered-user", state.user?.id)
            assertEquals(true, state.signedIn)
            assertEquals(true, state.emailVerificationPromptVisible)
            assertEquals("注册成功，6 位邮箱验证码已发送。", state.message)
        } finally {
            fixture.close()
        }
    }

    private fun fixture(
        olderLogin: CompletableDeferred<UserView>,
        newerLogin: CompletableDeferred<UserView>,
        verificationRequest: CompletableDeferred<Unit> = CompletableDeferred(Unit),
        verificationConfirmation: CompletableDeferred<Unit> = CompletableDeferred(Unit),
        hasDeviceCredential: Boolean = false,
        lateRevoke: CompletableDeferred<Unit> = CompletableDeferred(Unit),
        registration: CompletableDeferred<UserView> = CompletableDeferred(),
    ): Fixture {
        val repository = mockk<LighthouseRepository>(relaxed = true)
        every { repository.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        every { repository.hasDeviceCredential() } returns hasDeviceCredential
        every { repository.hasUserSession() } returns false
        coEvery { repository.restoreUser() } returns null
        coEvery { repository.login("older", any()) } coAnswers { olderLogin.await() }
        coEvery { repository.login("newer", any()) } coAnswers { newerLogin.await() }
        coEvery { repository.register(any(), any(), any(), any()) } coAnswers {
            registration.await()
        }
        coEvery { repository.logout() } returns Unit
        coEvery { repository.listHouseholds() } returns emptyList()
        coEvery { repository.requestEmailVerification(any(), any()) } coAnswers {
            verificationRequest.await()
        }
        coEvery { repository.confirmEmailVerification(any(), any()) } coAnswers {
            verificationConfirmation.await()
        }
        coEvery { repository.getMe() } returns user("newer")
        coEvery { repository.getDeviceContext() } returns deviceContext()
        coEvery { repository.revokeUserSessionForCompanionMode() } coAnswers {
            lateRevoke.await()
        }

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

    private fun user(account: String) = UserView(
        id = "$account-user",
        displayName = account,
        status = "ACTIVE",
        primaryIdentity = account,
        email = "$account@example.com",
        emailVerified = true,
    )

    private fun deviceContext() = DeviceContextView(
        deviceId = "device-1",
        bindingId = "binding-1",
        householdId = "household-1",
        recipientId = "recipient-1",
        recipientName = "Recipient",
        timezone = "Asia/Shanghai",
        modelProvider = "OPENBMB",
        modelName = "MiniCPM-o 4.5",
        realtimeUrl = "wss://example.invalid/realtime",
        consentDecisions = emptyMap(),
    )

    private data class Fixture(
        val viewModel: LighthouseViewModel,
        val repository: LighthouseRepository,
    ) {
        fun close() {
            viewModel.viewModelScope.cancel()
        }
    }
}
