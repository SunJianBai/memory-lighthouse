package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.UserSession
import com.sun.minicpmo_android.lighthouse.model.RemoteSessionView
import com.sun.minicpmo_android.lighthouse.model.RequestedRemoteMedia
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.network.LighthouseHttpClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LighthouseRepositoryAuthenticationOwnershipTest {
    @Test
    fun lateLoginResponseCannotRestoreAUserSessionAfterLogout() = runTest {
        val loginResponse = CompletableDeferred<JSONObject>()
        val fixture = fixture(
            loginResponses = mapOf("older" to loginResponse),
        )

        val login = async {
            runCatching { fixture.repository.login("older", "password") }
        }
        runCurrent()

        fixture.repository.logout()
        loginResponse.complete(sessionJson("older"))
        runCurrent()

        assertTrue(login.await().isFailure)
        assertNull(fixture.persistedSession())
    }

    @Test
    fun olderLoginCannotReplaceANewerLoginAndEachMeRequestUsesItsCapturedToken() = runTest {
        val olderResponse = CompletableDeferred<JSONObject>()
        val newerResponse = CompletableDeferred<JSONObject>()
        val fixture = fixture(
            loginResponses = mapOf(
                "older" to olderResponse,
                "newer" to newerResponse,
            ),
        )

        val olderLogin = async {
            runCatching { fixture.repository.login("older", "password") }
        }
        runCurrent()
        val newerLogin = async {
            runCatching { fixture.repository.login("newer", "password") }
        }
        runCurrent()

        newerResponse.complete(sessionJson("newer"))
        runCurrent()
        assertEquals("newer-user", newerLogin.await().getOrThrow().id)

        olderResponse.complete(sessionJson("older"))
        runCurrent()

        assertTrue(olderLogin.await().isFailure)
        assertEquals("newer-session", fixture.persistedSession()?.sessionId)
        assertEquals(listOf("access-newer", "access-older"), fixture.meTokens)
    }

    @Test
    fun olderRegistrationCannotReplaceANewerLoginSession() = runTest {
        val registrationResponse = CompletableDeferred<JSONObject>()
        val fixture = fixture(
            loginResponses = mapOf(
                "newer" to CompletableDeferred(sessionJson("newer")),
            ),
            registrationResponse = registrationResponse,
        )

        val registration = async {
            runCatching {
                fixture.repository.register(
                    email = "older@example.com",
                    username = "older",
                    password = "password",
                    displayName = "Older",
                )
            }
        }
        runCurrent()
        assertEquals("newer-user", fixture.repository.login("newer", "password").id)

        registrationResponse.complete(sessionJson("older"))
        runCurrent()

        assertTrue(registration.await().isFailure)
        assertEquals("newer-session", fixture.persistedSession()?.sessionId)
    }

    @Test
    fun refreshResponseCannotRestoreTheSessionAfterLogout() = runTest {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        var persistedSession: UserSession? = session("older")
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } answers { persistedSession }
        every { vault.saveUserSession(any()) } answers {
            persistedSession = firstArg<UserSession?>()
        }
        val refreshResponse = CompletableDeferred<JSONObject>()
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request("GET", "households", null, "access-older", emptyMap())
        } throws LighthouseApiException(401, "TOKEN_EXPIRED", "expired")
        coEvery {
            http.request("POST", "auth/refresh", any(), null, emptyMap())
        } coAnswers { refreshResponse.await() }
        coEvery {
            http.request("POST", "auth/logout", any(), "access-older", emptyMap())
        } returns null
        coEvery {
            http.request("POST", "auth/logout", any(), "access-refreshed", emptyMap())
        } returns null
        coEvery {
            http.request("GET", "households", null, "access-refreshed", emptyMap())
        } returns JSONObject().put("value", JSONArray())
        val repository = LighthouseRepository(
            settings = settings,
            vault = vault,
            signer = mockk(relaxed = true),
            httpClient = http,
        )

        val households = async { runCatching { repository.listHouseholds() } }
        runCurrent()
        repository.logout()
        refreshResponse.complete(sessionJson("refreshed"))
        runCurrent()

        assertTrue(households.await().isFailure)
        assertNull(persistedSession)
        coVerify(exactly = 0) {
            http.request("GET", "households", null, "access-refreshed", emptyMap())
        }
        coVerify(exactly = 1) {
            http.request("POST", "auth/logout", any(), "access-refreshed", emptyMap())
        }
    }

    @Test
    fun oldRefreshRejectionCannotClearANewerSuccessfulLogin() = runTest {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        var persistedSession: UserSession? = session("older")
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } answers { persistedSession }
        every { vault.saveUserSession(any()) } answers {
            persistedSession = firstArg<UserSession?>()
        }
        val refreshResponse = CompletableDeferred<JSONObject>()
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request("GET", "households", null, "access-older", emptyMap())
        } throws LighthouseApiException(401, "TOKEN_EXPIRED", "expired")
        coEvery {
            http.request("POST", "auth/refresh", any(), null, emptyMap())
        } coAnswers { refreshResponse.await() }
        coEvery {
            http.request("POST", "auth/login", any(), null, emptyMap())
        } returns sessionJson("newer")
        coEvery {
            http.request("GET", "me", null, "access-newer", emptyMap())
        } returns userJson("newer")
        val repository = LighthouseRepository(
            settings = settings,
            vault = vault,
            signer = mockk(relaxed = true),
            httpClient = http,
        )

        val oldRequest = async { runCatching { repository.listHouseholds() } }
        runCurrent()
        assertEquals("newer-user", repository.login("newer", "password").id)
        refreshResponse.completeExceptionally(
            LighthouseApiException(401, "REFRESH_REJECTED", "rejected"),
        )
        runCurrent()

        assertTrue(oldRequest.await().isFailure)
        assertEquals("newer-session", persistedSession?.sessionId)
    }

    @Test
    fun oldAccountRequestCannotRetryWithANewerAccountsAccessToken() = runTest {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        var persistedSession: UserSession? = session("older")
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } answers { persistedSession }
        every { vault.saveUserSession(any()) } answers {
            persistedSession = firstArg<UserSession?>()
        }
        val oldVerification = CompletableDeferred<JSONObject?>()
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request(
                "POST",
                AuthApiContract.emailVerificationsPath(),
                any(),
                "access-older",
                emptyMap(),
            )
        } coAnswers { oldVerification.await() }
        coEvery {
            http.request("POST", "auth/login", any(), null, emptyMap())
        } returns sessionJson("newer")
        coEvery {
            http.request("GET", "me", null, "access-newer", emptyMap())
        } returns userJson("newer")
        coEvery {
            http.request(
                "POST",
                AuthApiContract.emailVerificationsPath(),
                any(),
                "access-newer",
                emptyMap(),
            )
        } returns null
        val repository = LighthouseRepository(
            settings = settings,
            vault = vault,
            signer = mockk(relaxed = true),
            httpClient = http,
        )

        val verification = async {
            runCatching { repository.requestEmailVerification("older@example.com") }
        }
        runCurrent()
        assertEquals("newer-user", repository.login("newer", "password").id)
        oldVerification.completeExceptionally(
            LighthouseApiException(401, "TOKEN_EXPIRED", "expired"),
        )
        runCurrent()

        assertTrue(verification.await().isFailure)
        coVerify(exactly = 0) {
            http.request(
                "POST",
                AuthApiContract.emailVerificationsPath(),
                any(),
                "access-newer",
                emptyMap(),
            )
        }
    }

    @Test
    fun terminalRefreshExpiryDuringRestoreReturnsSignedOutInsteadOfSuperseded() = runTest {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        var persistedSession: UserSession? = session("expired")
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } answers { persistedSession }
        every { vault.saveUserSession(any()) } answers {
            persistedSession = firstArg<UserSession?>()
        }
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request("GET", "me", null, "access-expired", emptyMap())
        } throws LighthouseApiException(401, "TOKEN_EXPIRED", "expired")
        coEvery {
            http.request("POST", "auth/refresh", any(), null, emptyMap())
        } throws LighthouseApiException(401, "REFRESH_REJECTED", "rejected")
        val repository = LighthouseRepository(
            settings = settings,
            vault = vault,
            signer = mockk(relaxed = true),
            httpClient = http,
        )

        assertNull(repository.restoreUser())
        assertNull(persistedSession)
    }

    @Test
    fun logoutWithExpiredAccessRefreshesOnlyToRevokeTheCapturedSession() = runTest {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        var persistedSession: UserSession? = session("expired")
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } answers { persistedSession }
        every { vault.saveUserSession(any()) } answers {
            persistedSession = firstArg<UserSession?>()
        }
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request("POST", "auth/logout", any(), "access-expired", emptyMap())
        } throws LighthouseApiException(401, "TOKEN_EXPIRED", "expired")
        coEvery {
            http.request("POST", "auth/refresh", any(), null, emptyMap())
        } returns sessionJson("logout-refresh")
        coEvery {
            http.request("POST", "auth/logout", any(), "access-logout-refresh", emptyMap())
        } returns null
        val repository = LighthouseRepository(
            settings = settings,
            vault = vault,
            signer = mockk(relaxed = true),
            httpClient = http,
        )

        repository.logout()

        assertNull(persistedSession)
        coVerify(exactly = 1) {
            http.request("POST", "auth/refresh", any(), null, emptyMap())
        }
        coVerify(exactly = 1) {
            http.request("POST", "auth/logout", any(), "access-logout-refresh", emptyMap())
        }
    }

    @Test
    fun logoutClearsLocalAuthorityBeforeEndingTheCapturedFamilyRemoteSession() = runTest {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        var persistedSession: UserSession? = session("family")
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } answers { persistedSession }
        every { vault.saveUserSession(any()) } answers {
            persistedSession = firstArg<UserSession?>()
        }
        val remoteEndStarted = CompletableDeferred<Unit>()
        val releaseRemoteEnd = CompletableDeferred<Unit>()
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request(
                "POST",
                "households/household-1/remote-sessions/remote-1/end",
                any(),
                "access-family",
                emptyMap(),
            )
        } coAnswers {
            remoteEndStarted.complete(Unit)
            releaseRemoteEnd.await()
            null
        }
        coEvery {
            http.request("POST", "auth/logout", any(), "access-family", emptyMap())
        } returns null
        val repository = LighthouseRepository(
            settings = settings,
            vault = vault,
            signer = mockk(relaxed = true),
            httpClient = http,
        )

        val logout = async { repository.logout(remoteSession()) }
        runCurrent()

        assertTrue(remoteEndStarted.isCompleted)
        assertNull(persistedSession)
        releaseRemoteEnd.complete(Unit)
        runCurrent()
        logout.await()

        coVerify(exactly = 1) {
            http.request("POST", "auth/logout", any(), "access-family", emptyMap())
        }
    }

    @Test
    fun completingAnOldRevocationCannotClearANewerLogin() = runTest {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        var persistedSession: UserSession? = session("older")
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } answers { persistedSession }
        every { vault.saveUserSession(any()) } answers {
            persistedSession = firstArg<UserSession?>()
        }
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request("POST", "auth/login", any(), null, emptyMap())
        } returns sessionJson("newer")
        coEvery {
            http.request("GET", "me", null, "access-newer", emptyMap())
        } returns userJson("newer")
        coEvery {
            http.request("POST", "auth/logout", any(), "access-older", emptyMap())
        } returns null
        val repository = LighthouseRepository(
            settings = settings,
            vault = vault,
            signer = mockk(relaxed = true),
            httpClient = http,
        )

        val oldRevocation = repository.beginUserSessionRevocation()
        assertNull(persistedSession)
        assertEquals("newer-user", repository.login("newer", "password").id)

        repository.completeUserSessionRevocation(oldRevocation)

        assertEquals("newer-session", persistedSession?.sessionId)
        coVerify(exactly = 1) {
            http.request("POST", "auth/logout", any(), "access-older", emptyMap())
        }
    }

    private fun fixture(
        loginResponses: Map<String, CompletableDeferred<JSONObject>>,
        registrationResponse: CompletableDeferred<JSONObject>? = null,
    ): Fixture {
        val settings = mockk<AppSettingsRepository>()
        every { settings.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"

        var persistedSession: UserSession? = null
        var careNamespace: String? = null
        val vault = mockk<CredentialVault>(relaxed = true)
        every { vault.userSession() } answers { persistedSession }
        every { vault.saveUserSession(any()) } answers {
            persistedSession = firstArg<UserSession?>()
        }
        every { vault.userCareNamespace() } answers { careNamespace }
        every { vault.saveUserCareNamespace(any()) } answers {
            careNamespace = firstArg<String?>()
        }

        val meTokens = mutableListOf<String>()
        val http = mockk<LighthouseHttpClient>()
        coEvery {
            http.request("POST", "auth/login", any(), null, emptyMap())
        } coAnswers {
            val identifier = thirdArg<JSONObject>().getString("identifier")
            requireNotNull(loginResponses[identifier]).await()
        }
        registrationResponse?.let { response ->
            coEvery {
                http.request("POST", "auth/register", any(), null, emptyMap())
            } coAnswers { response.await() }
        }
        coEvery {
            http.request("GET", "me", null, any(), emptyMap())
        } coAnswers {
            val token = arg<String>(3)
            meTokens += token
            userJson(token.removePrefix("access-"))
        }

        return Fixture(
            repository = LighthouseRepository(
                settings = settings,
                vault = vault,
                signer = mockk(relaxed = true),
                httpClient = http,
            ),
            persistedSession = { persistedSession },
            meTokens = meTokens,
        )
    }

    private fun sessionJson(account: String) = JSONObject()
        .put("accessToken", "access-$account")
        .put("accessTokenExpiresAt", "2026-08-25T12:00:00Z")
        .put("refreshToken", "refresh-$account")
        .put("refreshTokenExpiresAt", "2026-09-25T12:00:00Z")
        .put("sessionId", "$account-session")

    private fun session(account: String) = UserSession(
        accessToken = "access-$account",
        accessTokenExpiresAt = "2026-08-25T12:00:00Z",
        refreshToken = "refresh-$account",
        refreshTokenExpiresAt = "2026-09-25T12:00:00Z",
        sessionId = "$account-session",
    )

    private fun userJson(account: String) = JSONObject()
        .put("id", "$account-user")
        .put("displayName", account)
        .put("status", "ACTIVE")
        .put("identities", JSONArray())

    private fun remoteSession() = RemoteSessionView(
        id = "remote-1",
        householdId = "household-1",
        recipientId = "recipient-1",
        bindingId = "binding-1",
        status = "ACCEPTED",
        media = RequestedRemoteMedia(),
        requestedAt = "2026-08-25T00:00:00Z",
        acceptedAt = "2026-08-25T00:00:01Z",
        connectedAt = null,
        endedAt = null,
        endReason = null,
    )

    private data class Fixture(
        val repository: LighthouseRepository,
        val persistedSession: () -> UserSession?,
        val meTokens: List<String>,
    )
}
