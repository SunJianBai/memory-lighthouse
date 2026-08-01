package com.sun.minicpmo_android.lighthouse.call

import android.content.Context
import android.telecom.DisconnectCause
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.model.RemoteSessionView
import com.sun.minicpmo_android.lighthouse.model.DeviceHeartbeatView
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.realtime.CallLifecycleEvent
import com.sun.minicpmo_android.lighthouse.realtime.CallLifecyclePolicy
import com.sun.minicpmo_android.lighthouse.realtime.CallLifecycleState
import com.sun.minicpmo_android.lighthouse.realtime.CallSide
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallPhase
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import com.sun.minicpmo_android.lighthouse.realtime.LiveKitCallController
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import livekit.org.webrtc.SurfaceViewRenderer

data class CoordinatedRemoteCallState(
    val incoming: RemoteSessionView? = null,
    val active: RemoteSessionView? = null,
    val lifecycle: CallLifecycleState = CallLifecyclePolicy.initial(),
)

internal interface CompanionCallRuntime {
    fun showDiscovery()
    fun showIncoming(session: RemoteSessionView)
    fun showOngoing(session: RemoteSessionView)
    fun stopAfterRevocation()
}

/**
 * Process-wide owner for Telecom, LiveKit and companion remote-call state.
 * Activities and foreground services observe this coordinator instead of
 * owning or tearing down media independently.
 */
class RemoteCallCoordinator(
    context: Context,
    private val repository: LighthouseRepository,
    private val scope: CoroutineScope,
    private val mediaHandoff: CompanionMediaHandoffOrchestrator,
) {
    private val appContext = context.applicationContext
    private val liveKit = LiveKitCallController(appContext, scope)
    private val _state = MutableStateFlow(CoordinatedRemoteCallState())
    val state: StateFlow<CoordinatedRemoteCallState> = _state.asStateFlow()
    val liveCallState: StateFlow<LiveCallState> = liveKit.state
    val companionMediaHandoffState: StateFlow<CompanionMediaHandoffState> = mediaHandoff.state

    private val transitionMutex = Mutex()
    private var runtime: CompanionCallRuntime? = null
    private var discoveryJob: Job? = null
    private var heartbeatJob: Job? = null
    private val mediaStarts = mutableMapOf<String, CompletableDeferred<Boolean>>()
    private var handlingLiveKitFailure = false

    private val telecom = CoreTelecomController(
        context = appContext,
        scope = scope,
        onAnswer = { sessionId ->
            CompanionCallService.openIncomingUi(appContext, sessionId)
            withTimeout(4_500) { acceptIncoming(sessionId, true) }
        },
        onDisconnect = { sessionId, cause ->
            withTimeout(4_500) {
                if (cause.code == DisconnectCause.REJECTED || cause.code == DisconnectCause.MISSED) {
                    declineIncoming(sessionId, true)
                } else {
                    endCompanionCall(sessionId, true, "telecom_disconnected")
                }
            }
        },
        onSetActive = { sessionId ->
            check(_state.value.active?.id == sessionId) { "Call has not been locally answered" }
        },
        onSetInactive = { sessionId ->
            withTimeout(4_500) { endCompanionCall(sessionId, true, "telecom_inactive") }
        },
        onFailure = { sessionId, error -> failCompanionCall(sessionId, error) },
    )

    init {
        scope.launch {
            liveKit.state.collect { media ->
                val active = _state.value.active ?: return@collect
                when (media.phase) {
                    LiveCallPhase.CONNECTED -> {
                        val lifecycle = _state.value.lifecycle.transition(
                            CallLifecycleEvent.MediaConnected(active.id),
                        )
                        _state.value = _state.value.copy(lifecycle = lifecycle)
                        runtime?.showOngoing(active)
                    }
                    LiveCallPhase.ERROR -> failCompanionCall(
                        active.id,
                        IllegalStateException(media.message.ifBlank { "media_failed" }),
                    )
                    LiveCallPhase.ENDED -> {
                        if (!handlingLiveKitFailure) {
                            failCompanionCall(
                                active.id,
                                IllegalStateException(media.message.ifBlank { "media_ended" }),
                            )
                        }
                    }
                    else -> Unit
                }
            }
        }
    }

    fun ensureCompanionDiscoveryRunning() {
        CompanionCallService.start(appContext)
    }

    internal fun attachRuntime(value: CompanionCallRuntime) {
        runtime = value
        when {
            _state.value.active != null -> value.showOngoing(requireNotNull(_state.value.active))
            _state.value.incoming != null -> value.showIncoming(requireNotNull(_state.value.incoming))
            else -> value.showDiscovery()
        }
        startDiscovery()
    }

    internal fun detachRuntime(value: CompanionCallRuntime) {
        if (runtime === value) runtime = null
        discoveryJob?.cancel()
        discoveryJob = null
    }

    suspend fun acceptIncoming(sessionId: String, fromTelecom: Boolean = false) =
        mediaHandoff.handoffForRemoteAnswer(sessionId) {
            acceptIncomingAfterLocalStop(sessionId, fromTelecom)
        }

    fun attachLocalCompanionStopConsumer() = mediaHandoff.attachLocalStopConsumer()

    fun detachLocalCompanionStopConsumer() = mediaHandoff.detachLocalStopConsumer()

    fun completeLocalCompanionStop(requestId: Long) =
        mediaHandoff.completeLocalStop(requestId)

    fun failLocalCompanionStop(requestId: Long, error: Throwable) =
        mediaHandoff.failLocalStop(requestId, error)

    suspend fun applyDeviceHeartbeat(heartbeat: DeviceHeartbeatView) =
        mediaHandoff.applyMediaDirective(heartbeat.mediaDirective)

    suspend fun recordDeviceHeartbeat() {
        val localCompanionActive = repository.hasActiveCompanionSession()
        try {
            applyDeviceHeartbeat(repository.heartbeat())
        } catch (error: Throwable) {
            if (localCompanionActive) {
                runCatching {
                    mediaHandoff.applyHeartbeatFailure(localCompanionActive = true)
                }.exceptionOrNull()?.let(error::addSuppressed)
                repository.clearActiveCompanionSessionTracking()
            }
            throw error
        }
    }

    private suspend fun acceptIncomingAfterLocalStop(
        sessionId: String,
        fromTelecom: Boolean,
    ) {
        transitionMutex.withLock {
            val remote = (_state.value.incoming ?: _state.value.active)
                ?.takeIf { it.id == sessionId }
                ?: error("来电已失效")
            val answered = _state.value.lifecycle.transition(
                CallLifecycleEvent.LocalAnswerConfirmed(sessionId),
            )
            check(answered.mediaForegroundAllowed) { "必须由现场用户明确接听" }
            _state.value = _state.value.copy(lifecycle = answered)

            var acceptedForCleanup: RemoteSessionView? = null
            try {
                check(startMediaForeground(remote)) {
                    "无法启动摄像头和麦克风前台服务；请在解锁后从来电通知重新接听"
                }
                val accepted = if (remote.status == "RINGING") {
                    repository.acceptDeviceRemoteSession(remote.id)
                } else {
                    remote
                }
                acceptedForCleanup = accepted
                if (!fromTelecom) telecom.answer(remote.id)
                val ticket = repository.deviceJoinTicket(remote.id)
                _state.value = _state.value.copy(
                    incoming = null,
                    active = accepted,
                )
                runtime?.showOngoing(accepted)
                liveKit.connect(ticket, CallSide.DEVICE)
                startHeartbeat(remote.id)
            } catch (error: Throwable) {
                acceptedForCleanup?.let { runCatching { repository.endDeviceRemoteSession(it.id) } }
                releaseLocal(
                    sessionId,
                    CallLifecycleEvent.Failed(sessionId, error.message ?: "accept_failed"),
                    DisconnectCause.LOCAL,
                )
                throw error
            }
        }
    }

    suspend fun declineIncoming(sessionId: String, fromTelecom: Boolean = false) {
        transitionMutex.withLock {
            val incoming = _state.value.incoming?.takeIf { it.id == sessionId } ?: return
            runCatching { repository.declineDeviceRemoteSession(incoming.id) }
            releaseLocal(
                sessionId,
                CallLifecycleEvent.LocalDecline(sessionId),
                DisconnectCause.REJECTED,
                notifyTelecom = !fromTelecom,
            )
        }
    }

    suspend fun endCompanionCall(
        sessionId: String,
        fromTelecom: Boolean = false,
        reason: String = "user_ended",
    ) {
        transitionMutex.withLock {
            val current = (_state.value.active ?: _state.value.incoming)
                ?.takeIf { it.id == sessionId } ?: return
            runCatching {
                if (current.status == "RINGING") {
                    repository.declineDeviceRemoteSession(current.id)
                } else {
                    repository.endDeviceRemoteSession(current.id)
                }
            }
            releaseLocal(
                sessionId,
                CallLifecycleEvent.LocalHangup(sessionId),
                DisconnectCause.LOCAL,
                notifyTelecom = !fromTelecom,
                reason = reason,
            )
        }
    }

    fun connectFamily(ticket: com.sun.minicpmo_android.lighthouse.model.RemoteJoinTicket) {
        liveKit.connect(ticket, CallSide.FAMILY)
    }

    fun disconnectFamily(reason: String = "user_ended") {
        liveKit.disconnect(reason)
    }

    fun attachRenderer(renderer: SurfaceViewRenderer) = liveKit.attachRenderer(renderer)

    fun detachRenderer(renderer: SurfaceViewRenderer) = liveKit.detachRenderer(renderer)

    internal fun mediaForegroundStarted(sessionId: String) {
        synchronized(mediaStarts) { mediaStarts[sessionId] }?.complete(true)
    }

    internal fun mediaForegroundFailed(sessionId: String) {
        synchronized(mediaStarts) { mediaStarts[sessionId] }?.complete(false)
    }

    internal fun mediaForegroundLost(sessionId: String) {
        if (_state.value.active?.id != sessionId) return
        scope.launch {
            failCompanionCall(
                sessionId,
                IllegalStateException("media_foreground_service_stopped"),
            )
        }
    }

    private fun startDiscovery() {
        if (discoveryJob?.isActive == true || !repository.hasDeviceCredential()) return
        discoveryJob = scope.launch {
            while (isActive && repository.hasDeviceCredential()) {
                try {
                    recordDeviceHeartbeat()
                    reconcile(repository.currentDeviceRemoteSession())
                } catch (error: LighthouseApiException) {
                    if (error.code == "DEVICE_NOT_ACTIVATED" || error.status == 401) {
                        revokeAndStop()
                        return@launch
                    }
                } catch (_: Throwable) {
                    // Network loss must not silently open media or discard an
                    // already visible call. The authenticated poll retries.
                }
                delay(DISCOVERY_INTERVAL_MILLIS)
            }
        }
    }

    private suspend fun reconcile(remote: RemoteSessionView?) {
        val current = _state.value
        if (remote == null || remote.status in TERMINAL_STATUSES) {
            val sessionId = current.active?.id ?: current.incoming?.id ?: return
            releaseLocal(
                sessionId,
                CallLifecycleEvent.LocalHangup(sessionId),
                DisconnectCause.REMOTE,
                reason = remote?.endReason ?: "remote_ended",
            )
            return
        }

        if (current.active?.id == remote.id && current.lifecycle.mediaForegroundAllowed) {
            _state.value = current.copy(active = remote)
            return
        }
        if (current.incoming?.id == remote.id) {
            _state.value = current.copy(incoming = remote)
            return
        }

        current.active?.id?.let {
            releaseLocal(
                it,
                CallLifecycleEvent.LocalHangup(it),
                DisconnectCause.REMOTE,
                reason = "replaced_by_new_call",
            )
        }
        val lifecycle = CallLifecyclePolicy.initial().transition(
            CallLifecycleEvent.IncomingDiscovered(remote.id),
        )
        _state.value = CoordinatedRemoteCallState(incoming = remote, lifecycle = lifecycle)
        // The CallStyle notification is posted before addCall, satisfying Core
        // Telecom's five-second foreground-notification requirement.
        runtime?.showIncoming(remote)
        telecom.presentIncoming(remote)
    }

    private suspend fun startMediaForeground(remote: RemoteSessionView): Boolean {
        val ready = CompletableDeferred<Boolean>()
        synchronized(mediaStarts) { mediaStarts[remote.id] = ready }
        return try {
            CompanionMediaService.start(appContext, remote)
            withTimeout(MEDIA_SERVICE_TIMEOUT_MILLIS) { ready.await() }
        } catch (_: Throwable) {
            false
        } finally {
            synchronized(mediaStarts) { mediaStarts.remove(remote.id) }
        }
    }

    private fun startHeartbeat(sessionId: String) {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && _state.value.active?.id == sessionId) {
                runCatching { repository.remoteHeartbeat(sessionId) }
                delay(HEARTBEAT_INTERVAL_MILLIS)
            }
        }
    }

    private suspend fun failCompanionCall(sessionId: String, error: Throwable) {
        val current = _state.value.active ?: _state.value.incoming
        if (current?.id != sessionId || handlingLiveKitFailure) return
        handlingLiveKitFailure = true
        try {
            runCatching {
                if (current.status == "RINGING") {
                    repository.declineDeviceRemoteSession(sessionId)
                } else {
                    repository.endDeviceRemoteSession(sessionId)
                }
            }
            releaseLocal(
                sessionId,
                CallLifecycleEvent.Failed(sessionId, error.message ?: "media_failed"),
                DisconnectCause.LOCAL,
            )
        } finally {
            handlingLiveKitFailure = false
        }
    }

    private suspend fun revokeAndStop() {
        val sessionId = _state.value.active?.id ?: _state.value.incoming?.id
        if (sessionId != null) {
            releaseLocal(
                sessionId,
                CallLifecycleEvent.AuthorizationRevoked(sessionId),
                DisconnectCause.REMOTE,
                reason = "authorization_revoked",
            )
        }
        runtime?.stopAfterRevocation()
        discoveryJob?.cancel()
        discoveryJob = null
    }

    private suspend fun releaseLocal(
        sessionId: String,
        event: CallLifecycleEvent,
        causeCode: Int,
        notifyTelecom: Boolean = true,
        reason: String = "call_ended",
    ) {
        heartbeatJob?.cancel()
        heartbeatJob = null
        val lifecycle = _state.value.lifecycle.transition(event)
        _state.value = _state.value.copy(
            incoming = null,
            active = null,
            lifecycle = lifecycle,
        )
        liveKit.disconnect(reason)
        CompanionMediaService.stop(appContext)
        if (notifyTelecom) {
            telecom.disconnect(sessionId, DisconnectCause(causeCode))
        } else {
            telecom.forget(sessionId)
        }
        runtime?.showDiscovery()
    }

    private companion object {
        const val DISCOVERY_INTERVAL_MILLIS = 3_000L
        const val HEARTBEAT_INTERVAL_MILLIS = 15_000L
        const val MEDIA_SERVICE_TIMEOUT_MILLIS = 5_000L
        val TERMINAL_STATUSES = setOf(
            "DECLINED",
            "CANCELLED",
            "ENDED",
            "EXPIRED",
            "FAILED",
            "REVOKED",
        )
    }
}
