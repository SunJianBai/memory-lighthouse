package com.sun.minicpmo_android.lighthouse.call

import android.content.Context
import android.net.Uri
import android.telecom.DisconnectCause
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallsManager
import com.sun.minicpmo_android.lighthouse.model.RemoteSessionView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/** Thin adapter around the official Core-Telecom call lifecycle. */
internal class CoreTelecomController(
    context: Context,
    private val scope: CoroutineScope,
    private val onAnswer: suspend (sessionId: String) -> Unit,
    private val onDisconnect: suspend (sessionId: String, cause: DisconnectCause) -> Unit,
    private val onSetActive: suspend (sessionId: String) -> Unit,
    private val onSetInactive: suspend (sessionId: String) -> Unit,
    private val onFailure: suspend (sessionId: String, error: Throwable) -> Unit,
) {
    private val callsManager = CallsManager(context.applicationContext)
    private var registered = false
    private var session: TelecomSession? = null

    @Synchronized
    fun presentIncoming(remote: RemoteSessionView) {
        if (session?.sessionId == remote.id) return
        session?.job?.cancel()
        registerIfNeeded()

        val ready = CompletableDeferred<CallControlScope>()
        val callType = if (remote.media.receiveDeviceVideo) {
            CallAttributesCompat.CALL_TYPE_VIDEO_CALL
        } else {
            CallAttributesCompat.CALL_TYPE_AUDIO_CALL
        }
        val attributes = CallAttributesCompat(
            displayName = "家属",
            address = Uri.parse("memory-lighthouse://remote-call/${remote.id}"),
            direction = CallAttributesCompat.DIRECTION_INCOMING,
            callType = callType,
            // We do not support hold. If Telecom needs the microphone released,
            // the callback terminates the remote session instead.
            callCapabilities = 0,
        )
        val job = scope.launch {
            runCatching {
                callsManager.addCall(
                    callAttributes = attributes,
                    onAnswer = { onAnswer(remote.id) },
                    onDisconnect = { cause -> onDisconnect(remote.id, cause) },
                    onSetActive = { onSetActive(remote.id) },
                    onSetInactive = { onSetInactive(remote.id) },
                ) {
                    ready.complete(this)
                }
            }.onFailure { error ->
                if (!ready.isCompleted) ready.completeExceptionally(error)
                if (error !is CancellationException) onFailure(remote.id, error)
            }
        }
        session = TelecomSession(remote.id, callType, ready, job)
        job.invokeOnCompletion {
            synchronized(this) {
                if (session?.job === job) session = null
            }
        }
    }

    suspend fun answer(sessionId: String) {
        val current = requireSession(sessionId)
        checkSuccess(withTimeout(5_000) { current.ready.await().answer(current.callType) })
    }

    suspend fun disconnect(sessionId: String, cause: DisconnectCause) {
        val current = synchronized(this) { session?.takeIf { it.sessionId == sessionId } }
            ?: return
        runCatching {
            checkSuccess(withTimeout(5_000) { current.ready.await().disconnect(cause) })
        }
        current.job.cancel()
        synchronized(this) {
            if (session === current) session = null
        }
    }

    @Synchronized
    fun forget(sessionId: String) {
        session?.takeIf { it.sessionId == sessionId }?.let {
            it.job.cancel()
            session = null
        }
    }

    private fun registerIfNeeded() {
        if (registered) return
        callsManager.registerAppWithTelecom(
            CallsManager.CAPABILITY_BASELINE or CallsManager.CAPABILITY_SUPPORTS_VIDEO_CALLING,
        )
        registered = true
    }

    private fun requireSession(sessionId: String): TelecomSession = synchronized(this) {
        requireNotNull(session?.takeIf { it.sessionId == sessionId }) {
            "Telecom call is no longer available"
        }
    }

    private fun checkSuccess(result: CallControlResult) {
        if (result is CallControlResult.Error) {
            error("Telecom rejected call transition (${result.errorCode})")
        }
    }

    private data class TelecomSession(
        val sessionId: String,
        val callType: Int,
        val ready: CompletableDeferred<CallControlScope>,
        val job: Job,
    )
}
