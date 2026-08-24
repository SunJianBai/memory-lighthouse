package com.sun.minicpmo_android.lighthouse.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AuthApiContractTest {
    @Test
    fun emailVerificationRequestUsesTheAuthenticatedVerificationEndpoint() {
        val body = AuthApiContract.requestEmailVerificationBody("  family@example.com  ")

        assertEquals("auth/email-verifications", AuthApiContract.emailVerificationsPath())
        assertEquals("family@example.com", body.getString("email"))
        assertEquals(false, body.has("currentPassword"))
    }

    @Test
    fun firstEmailAttachmentCarriesTheCurrentPasswordWithoutTrimmingIt() {
        val body = AuthApiContract.requestEmailVerificationBody(
            "  family@example.com  ",
            " password with spaces ",
        )

        assertEquals("family@example.com", body.getString("email"))
        assertEquals(" password with spaces ", body.getString("currentPassword"))
    }

    @Test
    fun emailVerificationConfirmationCarriesTheEmailAndSixDigitCode() {
        val body = AuthApiContract.confirmEmailVerificationBody(
            email = "  family@example.com  ",
            code = " 123456 ",
        )

        assertEquals("auth/email-verifications/confirm", AuthApiContract.confirmEmailVerificationPath())
        assertEquals("family@example.com", body.getString("email"))
        assertEquals("123456", body.getString("code"))
    }

    @Test
    fun emailVerificationConfirmationRejectsMalformedCodesBeforeNetworkUse() {
        assertThrows(IllegalArgumentException::class.java) {
            AuthApiContract.confirmEmailVerificationBody("family@example.com", "12345x")
        }
    }
}
