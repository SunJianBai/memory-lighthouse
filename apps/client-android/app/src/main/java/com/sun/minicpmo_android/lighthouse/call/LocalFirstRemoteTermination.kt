package com.sun.minicpmo_android.lighthouse.call

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

internal suspend fun <T> runHandoffWithTerminalCompensation(
    handoff: suspend () -> T,
    alreadyTerminated: () -> Boolean,
    terminateBeforeRethrow: suspend (Throwable) -> Unit,
): T = try {
    handoff()
} catch (error: Throwable) {
    if (!alreadyTerminated()) {
        withContext(NonCancellable) {
            if (!alreadyTerminated()) terminateBeforeRethrow(error)
        }
    }
    throw error
}

internal suspend fun releaseMediaBeforeServerNotification(
    releaseLocalMedia: suspend () -> Unit,
    notifyServerBestEffort: suspend () -> Unit,
    onNotificationCancelled: () -> Unit = {},
) {
    releaseLocalMedia()
    try {
        notifyServerBestEffort()
    } catch (error: CancellationException) {
        onNotificationCancelled()
        throw error
    } catch (_: Throwable) {
        // Local privacy is already restored. The server lease and cleanup job
        // remain the fallback when the control plane cannot be reached.
    }
}
