package com.sun.minicpmo_android.lighthouse.call

import com.sun.minicpmo_android.lighthouse.model.DeviceMediaDirective
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicLong

enum class CompanionMediaStopReason { REMOTE_ANSWER, SERVER_DIRECTIVE }

sealed interface CompanionMediaHandoffState {
    data object Idle : CompanionMediaHandoffState

    data class StoppingLocalCompanion(
        val requestId: Long,
        val sessionId: String?,
        val reason: CompanionMediaStopReason,
    ) : CompanionMediaHandoffState

    data class AcceptingRemote(val sessionId: String) : CompanionMediaHandoffState
}

/**
 * Serializes ownership transfer away from MiniCPM. When a UI owns the local
 * camera/model runtime it must acknowledge the stop request before the server
 * accept transaction or LiveKit setup can begin.
 */
class CompanionMediaHandoffOrchestrator {
    private val operationMutex = Mutex()
    private val consumerLock = Any()
    private val requestIds = AtomicLong(0)
    private val _state = MutableStateFlow<CompanionMediaHandoffState>(
        CompanionMediaHandoffState.Idle,
    )
    val state: StateFlow<CompanionMediaHandoffState> = _state.asStateFlow()

    private var localStopConsumers = 0
    private var pendingStop: PendingStop? = null
    @Volatile
    private var serverStopLatched = false

    fun attachLocalStopConsumer() = synchronized(consumerLock) {
        localStopConsumers += 1
    }

    fun detachLocalStopConsumer() = synchronized(consumerLock) {
        localStopConsumers = (localStopConsumers - 1).coerceAtLeast(0)
        if (localStopConsumers == 0) {
            pendingStop?.completion?.completeExceptionally(
                IllegalStateException("Local companion stop consumer detached"),
            )
        }
    }

    suspend fun <T> handoffForRemoteAnswer(
        sessionId: String,
        acceptRemote: suspend () -> T,
    ): T = operationMutex.withLock {
        try {
            awaitLocalStop(sessionId, CompanionMediaStopReason.REMOTE_ANSWER)
            _state.value = CompanionMediaHandoffState.AcceptingRemote(sessionId)
            acceptRemote()
        } finally {
            clearPendingStop()
            _state.value = CompanionMediaHandoffState.Idle
        }
    }

    suspend fun applyMediaDirective(directive: DeviceMediaDirective) {
        if (directive != DeviceMediaDirective.STOP) {
            serverStopLatched = false
            return
        }
        operationMutex.withLock {
            if (serverStopLatched) return@withLock
            try {
                awaitLocalStop(null, CompanionMediaStopReason.SERVER_DIRECTIVE)
                serverStopLatched = true
            } finally {
                clearPendingStop()
                _state.value = CompanionMediaHandoffState.Idle
            }
        }
    }

    suspend fun applyHeartbeatFailure(localCompanionActive: Boolean) {
        if (localCompanionActive) applyMediaDirective(DeviceMediaDirective.STOP)
    }

    fun completeLocalStop(requestId: Long) = synchronized(consumerLock) {
        pendingStop?.takeIf { it.requestId == requestId }?.completion?.complete(Unit)
    }

    fun failLocalStop(requestId: Long, error: Throwable) = synchronized(consumerLock) {
        pendingStop
            ?.takeIf { it.requestId == requestId }
            ?.completion
            ?.completeExceptionally(error)
    }

    private suspend fun awaitLocalStop(
        sessionId: String?,
        reason: CompanionMediaStopReason,
    ) {
        val requestId = requestIds.incrementAndGet()
        val completion = synchronized(consumerLock) {
            if (localStopConsumers == 0) {
                null
            } else {
                CompletableDeferred<Unit>().also {
                    pendingStop = PendingStop(requestId, it)
                }
            }
        }
        _state.value = CompanionMediaHandoffState.StoppingLocalCompanion(
            requestId = requestId,
            sessionId = sessionId,
            reason = reason,
        )
        completion?.await()
    }

    private fun clearPendingStop() = synchronized(consumerLock) {
        pendingStop = null
    }

    private data class PendingStop(
        val requestId: Long,
        val completion: CompletableDeferred<Unit>,
    )
}
