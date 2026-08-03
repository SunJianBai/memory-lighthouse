package com.sun.minicpmo_android.lighthouse.data

import org.json.JSONObject

internal object AuthApiContract {
    fun emailVerificationsPath() = "auth/email-verifications"

    fun confirmEmailVerificationPath() = "${emailVerificationsPath()}/confirm"

    fun requestEmailVerificationBody(email: String) = JSONObject()
        .put("email", email.trim())

    fun confirmEmailVerificationBody(email: String, code: String): JSONObject {
        val normalizedCode = code.trim()
        require(VERIFICATION_CODE.matches(normalizedCode)) { "请输入 6 位邮箱验证码" }
        return JSONObject()
            .put("email", email.trim())
            .put("code", normalizedCode)
    }

    private val VERIFICATION_CODE = Regex("^[0-9]{6}$")
}
