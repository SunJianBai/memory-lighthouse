package com.sun.minicpmo_android.lighthouse.call

import kotlinx.coroutines.CancellationException

internal class RemoteHeartbeatLeaseGuard(
    private val renewHeartbeat: suspend (String) -> Unit,
    private val onLeaseLost: suspend (String, Throwable) -> Unit,
) {
    suspend fun renew(sessionId: String): Boolean = try {
        renewHeartbeat(sessionId)
        true
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        onLeaseLost(sessionId, error)
        false
    }
}
