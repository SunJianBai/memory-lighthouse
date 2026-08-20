package com.sun.minicpmo_android.lighthouse.call

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.telecom.DisconnectCause
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallsManager
import androidx.core.content.ContextCompat
import com.sun.minicpmo_android.lighthouse.model.RemoteSessionView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

internal fun canPresentIncomingInTelecom(
    notificationGranted: Boolean,
    microphoneGranted: Boolean,
    cameraGranted: Boolean,
    needsMicrophone: Boolean,
    needsCamera: Boolean,
): Boolean = notificationGranted &&
    (!needsMicrophone || microphoneGranted) &&
    (!needsCamera || cameraGranted)

internal class RemoteCallPermissionsMissingException : IllegalStateException(
    "通知、摄像头或麦克风权限不完整；本次系统接听已安全断开，请打开应用补全权限后重试",
)

internal fun incomingTelecomPresentationRequired(
    currentSessionId: String?,
    incomingSessionId: String,
    permissionsGranted: Boolean,
): Boolean {
    if (!permissionsGranted) throw RemoteCallPermissionsMissingException()
    return currentSessionId != incomingSessionId
}

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
    private val appContext = context.applicationContext
    private val callsManager = CallsManager(appContext)
    private var registered = false
    private var session: TelecomSession? = null

    fun canPresentIncoming(remote: RemoteSessionView): Boolean =
        canPresentIncomingInTelecom(
            notificationGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                hasPermission(Manifest.permission.POST_NOTIFICATIONS),
            microphoneGranted = hasPermission(Manifest.permission.RECORD_AUDIO),
            cameraGranted = hasPermission(Manifest.permission.CAMERA),
            needsMicrophone = remote.media.receiveDeviceAudio,
            needsCamera = remote.media.receiveDeviceVideo,
        )

    @Synchronized
    fun presentIncoming(remote: RemoteSessionView) {
        if (
            !incomingTelecomPresentationRequired(
                currentSessionId = session?.sessionId,
                incomingSessionId = remote.id,
                permissionsGranted = canPresentIncoming(remote),
            )
        ) return
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
                    onAnswer = {
                        if (!canPresentIncoming(remote)) {
                            throw RemoteCallPermissionsMissingException()
                        }
                        onAnswer(remote.id)
                    },
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

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(appContext, permission) ==
            PackageManager.PERMISSION_GRANTED

    private data class TelecomSession(
        val sessionId: String,
        val callType: Int,
        val ready: CompletableDeferred<CallControlScope>,
        val job: Job,
    )
}
