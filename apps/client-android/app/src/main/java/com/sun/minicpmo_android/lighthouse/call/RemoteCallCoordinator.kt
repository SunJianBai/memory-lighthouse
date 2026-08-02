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
import com.sun.minicpmo_android.lighthouse.realtime.remoteFailureMessage
import com.sun.minicpmo_android.lighthouse.realtime.remoteFailureTitle
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withContext
import livekit.org.webrtc.SurfaceViewRenderer
import java.util.concurrent.ConcurrentHashMap

data class CoordinatedRemoteCallState(
    val incoming: RemoteSessionView? = null,
    val active: RemoteSessionView? = null,
    val lifecycle: CallLifecycleState = CallLifecyclePolicy.initial(),
    val failureTitle: String? = null,
    val failureMessage: String? = null,
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
    private val locallyTerminatedSessionIds = ConcurrentHashMap.newKeySet<String>()
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
        runHandoffWithTerminalCompensation(
            handoff = {
                mediaHandoff.handoffForRemoteAnswer(sessionId) {
                    acceptIncomingAfterLocalStop(sessionId, fromTelecom)
                }
            },
            alreadyTerminated = { locallyTerminatedSessionIds.contains(sessionId) },
            terminateBeforeRethrow = { error ->
                transitionMutex.withLock {
                    if (locallyTerminatedSessionIds.contains(sessionId)) return@withLock
                    terminateLocalFirst(
                        sessionId = sessionId,
                        event = CallLifecycleEvent.Failed(
                            sessionId,
                            error.message ?: "media_handoff_failed",
                        ),
                        causeCode = DisconnectCause.LOCAL,
                        notifyTelecom = !fromTelecom,
                        notifyServerAsynchronously = true,
                    ) {
                        try {
                            repository.declineDeviceRemoteSession(sessionId)
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Throwable) {
                            repository.endDeviceRemoteSession(sessionId)
                        }
                    }
                }
            },
        )

    fun attachLocalCompanionStopConsumer() = mediaHandoff.attachLocalStopConsumer()

    fun detachLocalCompanionStopConsumer() = mediaHandoff.detachLocalStopConsumer()

    fun completeLocalCompanionStop(requestId: Long) =
        mediaHandoff.completeLocalStop(requestId)

    fun failLocalCompanionStop(requestId: Long, error: Throwable) =
        mediaHandoff.failLocalStop(requestId, error)

    fun dismissFailure() {
        _state.value = _state.value.copy(failureTitle = null, failureMessage = null)
    }

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
                    "无法启动摄像头和麦克风前台服务；本次来电已结束，请让家属重新发起"
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
                    failureTitle = null,
                    failureMessage = null,
                )
                runtime?.showOngoing(accepted)
                liveKit.connect(ticket, CallSide.DEVICE)
                startHeartbeat(remote.id)
            } catch (error: Throwable) {
                terminateLocalFirst(
                    sessionId,
                    CallLifecycleEvent.Failed(sessionId, error.message ?: "accept_failed"),
                    DisconnectCause.LOCAL,
                    notifyTelecom = !fromTelecom,
                ) {
                    if (acceptedForCleanup != null) {
                        repository.endDeviceRemoteSession(sessionId)
                    } else {
                        try {
                            repository.declineDeviceRemoteSession(sessionId)
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Throwable) {
                            // accept may have committed while its response was
                            // lost; fall back to ending that accepted session.
                            repository.endDeviceRemoteSession(sessionId)
                        }
                    }
                }
                throw error
            }
        }
    }

    suspend fun declineIncoming(sessionId: String, fromTelecom: Boolean = false) {
        transitionMutex.withLock {
            val incoming = _state.value.incoming?.takeIf { it.id == sessionId } ?: return
            terminateLocalFirst(
                sessionId,
                CallLifecycleEvent.LocalDecline(sessionId),
                DisconnectCause.REJECTED,
                notifyTelecom = !fromTelecom,
            ) { repository.declineDeviceRemoteSession(incoming.id) }
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
            terminateLocalFirst(
                sessionId,
                CallLifecycleEvent.LocalHangup(sessionId),
                DisconnectCause.LOCAL,
                notifyTelecom = !fromTelecom,
                reason = reason,
            ) {
                if (current.status == "RINGING") {
                    repository.declineDeviceRemoteSession(current.id)
                } else {
                    repository.endDeviceRemoteSession(current.id)
                }
            }
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
        if (remote == null) {
            locallyTerminatedSessionIds.clear()
            val sessionId = current.active?.id ?: current.incoming?.id ?: return
            releaseLocal(
                sessionId,
                CallLifecycleEvent.LocalHangup(sessionId),
                DisconnectCause.REMOTE,
                reason = "remote_ended",
            )
            return
        }
        if (locallyTerminatedSessionIds.contains(remote.id)) {
            if (remote.status in TERMINAL_STATUSES) {
                locallyTerminatedSessionIds.remove(remote.id)
            }
            return
        }
        if (remote.status in TERMINAL_STATUSES) {
            val sessionId = current.active?.id ?: current.incoming?.id ?: return
            releaseLocal(
                sessionId,
                CallLifecycleEvent.LocalHangup(sessionId),
                DisconnectCause.REMOTE,
                reason = remote.endReason ?: "remote_ended",
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
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            false
        } finally {
            synchronized(mediaStarts) { mediaStarts.remove(remote.id) }
        }
    }

    private fun startHeartbeat(sessionId: String) {
        heartbeatJob?.cancel()
        val leaseGuard = RemoteHeartbeatLeaseGuard(
            renewHeartbeat = repository::remoteHeartbeat,
            onLeaseLost = { failedSessionId, error ->
                // Clear the field before failCompanionCall tears down media so
                // releaseLocal does not cancel the coroutine performing teardown.
                heartbeatJob = null
                failCompanionCall(failedSessionId, error)
            },
        )
        heartbeatJob = scope.launch {
            while (isActive && _state.value.active?.id == sessionId) {
                if (!leaseGuard.renew(sessionId)) return@launch
                delay(HEARTBEAT_INTERVAL_MILLIS)
            }
        }
    }

    private suspend fun failCompanionCall(sessionId: String, error: Throwable) {
        val current = _state.value.active ?: _state.value.incoming
        if (current?.id != sessionId || handlingLiveKitFailure) return
        handlingLiveKitFailure = true
        try {
            terminateLocalFirst(
                sessionId,
                CallLifecycleEvent.Failed(sessionId, error.message ?: "media_failed"),
                DisconnectCause.LOCAL,
            ) {
                if (current.status == "RINGING") {
                    repository.declineDeviceRemoteSession(sessionId)
                } else {
                    repository.endDeviceRemoteSession(sessionId)
                }
            }
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
        val current = _state.value
        val failureTitle = if (event is CallLifecycleEvent.Failed) {
            current.lifecycle.remoteFailureTitle()
        } else {
            null
        }
        val failureMessage = if (event is CallLifecycleEvent.Failed) {
            current.lifecycle.remoteFailureMessage()
        } else {
            null
        }
        val lifecycle = current.lifecycle.transition(event)
        _state.value = _state.value.copy(
            incoming = null,
            active = null,
            lifecycle = lifecycle,
            failureTitle = failureTitle,
            failureMessage = failureMessage,
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

    private suspend fun terminateLocalFirst(
        sessionId: String,
        event: CallLifecycleEvent,
        causeCode: Int,
        notifyTelecom: Boolean = true,
        reason: String = "call_ended",
        notifyServerAsynchronously: Boolean = false,
        notifyServer: suspend () -> Unit,
    ) {
        locallyTerminatedSessionIds.add(sessionId)
        discoveryJob?.cancel()
        discoveryJob = null
        try {
            val serverNotification: suspend () -> Unit = if (notifyServerAsynchronously) {
                { enqueueServerTerminationCompensation(notifyServer) }
            } else {
                notifyServer
            }
            releaseMediaBeforeServerNotification(
                releaseLocalMedia = {
                    withContext(NonCancellable) {
                        releaseLocal(
                            sessionId = sessionId,
                            event = event,
                            causeCode = causeCode,
                            notifyTelecom = notifyTelecom,
                            reason = reason,
                        )
                    }
                },
                notifyServerBestEffort = serverNotification,
                onNotificationCancelled = {
                    enqueueServerTerminationCompensation(notifyServer)
                },
            )
        } finally {
            if (scope.isActive && repository.hasDeviceCredential()) startDiscovery()
        }
    }

    private fun enqueueServerTerminationCompensation(notifyServer: suspend () -> Unit) {
        scope.launch {
            withTimeoutOrNull(SERVER_TERMINATION_COMPENSATION_TIMEOUT_MILLIS) {
                try {
                    notifyServer()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Throwable) {
                    // The durable server lease/expiry cleanup remains the last
                    // resort when this bounded app-scope retry also fails.
                }
            }
        }
    }

    private companion object {
        const val DISCOVERY_INTERVAL_MILLIS = 3_000L
        const val HEARTBEAT_INTERVAL_MILLIS = 15_000L
        const val MEDIA_SERVICE_TIMEOUT_MILLIS = 5_000L
        const val SERVER_TERMINATION_COMPENSATION_TIMEOUT_MILLIS = 10_000L
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
