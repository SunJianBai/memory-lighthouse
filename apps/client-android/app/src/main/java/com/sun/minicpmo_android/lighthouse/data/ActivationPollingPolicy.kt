package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.DeviceCredential
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import kotlinx.coroutines.CancellationException
import java.io.IOException

sealed interface ActivationExchangeOutcome {
    data object Waiting : ActivationExchangeOutcome

    data class Activated(val credential: DeviceCredential) : ActivationExchangeOutcome

    data class Terminal(
        val status: String,
        val message: String,
    ) : ActivationExchangeOutcome
}

internal enum class ActivationChallengeDisposition {
    WAITING,
    EXCHANGE,
    TERMINAL,
    INVALID,
}

internal fun activationChallengeDisposition(status: String): ActivationChallengeDisposition =
    when (status) {
        "PENDING", "CLAIMED" -> ActivationChallengeDisposition.WAITING
        "APPROVED", "CONSUMED" -> ActivationChallengeDisposition.EXCHANGE
        "CANCELLED", "EXPIRED", "ATTEMPTS_EXCEEDED" ->
            ActivationChallengeDisposition.TERMINAL
        else -> ActivationChallengeDisposition.INVALID
    }

internal fun activationTerminalMessage(status: String): String = when (status) {
    "CANCELLED" -> "本次设备激活已取消，请重新扫描二维码或输入新的动态激活码"
    "EXPIRED" -> "本次设备激活已过期，请由家属生成新的激活凭据"
    "ATTEMPTS_EXCEEDED" -> "本次设备激活尝试次数已用尽，请由家属生成新的激活凭据"
    else -> "本次设备激活无法继续，请重新发起激活"
}

internal const val MAX_ACTIVATION_RECOVERY_CONFLICTS = 5

internal fun isActivationRecoveryConflict(error: Throwable): Boolean =
    error is LighthouseApiException &&
        error.code in setOf("ACTIVATION_ALREADY_CONSUMED", "ACTIVATION_STATE_CONFLICT")

internal fun shouldRetryActivationPolling(
    error: Throwable,
    recoveryConflictAttempts: Int = 0,
): Boolean {
    if (error is CancellationException) throw error
    if (error is IOException) return true
    if (error !is LighthouseApiException) return false
    if (error.status >= 500) return true
    return error.status == 408 ||
        error.status == 429 ||
        (isActivationRecoveryConflict(error) &&
            recoveryConflictAttempts < MAX_ACTIVATION_RECOVERY_CONFLICTS)
}

internal fun activationPollingRetryDelayMillis(error: Throwable): Long =
    if (error is LighthouseApiException && error.status == 429) 10_000L else 3_000L
