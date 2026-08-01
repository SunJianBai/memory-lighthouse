package com.sun.minicpmo_android.lighthouse.realtime

import android.content.Context
import com.sun.minicpmo_android.lighthouse.model.RemoteJoinTicket
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import livekit.org.webrtc.SurfaceViewRenderer
import java.lang.ref.WeakReference

enum class CallSide { FAMILY, DEVICE }

enum class LiveCallPhase { IDLE, CONNECTING, CONNECTED, ENDED, ERROR }

data class LiveCallState(
    val phase: LiveCallPhase = LiveCallPhase.IDLE,
    val sessionId: String? = null,
    val remoteVideoAvailable: Boolean = false,
    val microphonePublished: Boolean = false,
    val cameraPublished: Boolean = false,
    val message: String = "",
)

/**
 * Media-only LiveKit controller. The server ticket is the sole authority for
 * publish/subscribe grants. This class never publishes data, records media or
 * performs transcription.
 */
class LiveKitCallController(
    context: Context,
    private val scope: CoroutineScope,
) {
    private val appContext = context.applicationContext
    private val _state = MutableStateFlow(LiveCallState())
    val state: StateFlow<LiveCallState> = _state.asStateFlow()

    private var room: Room? = null
    private var connectJob: Job? = null
    private var eventJob: Job? = null
    private var remoteVideo: VideoTrack? = null
    private var renderer: WeakReference<SurfaceViewRenderer>? = null

    fun connect(ticket: RemoteJoinTicket, side: CallSide) {
        check(!ticket.recording && !ticket.transcription) {
            "远程家属通话必须禁用录制与转写"
        }
        disconnect("reconnect")
        _state.value = LiveCallState(
            phase = LiveCallPhase.CONNECTING,
            sessionId = ticket.sessionId,
            message = "正在建立加密音视频连接",
        )
        val job = scope.launch {
            runCatching {
                val newRoom = LiveKit.create(appContext)
                room = newRoom
                eventJob = launch {
                    newRoom.events.collect { event ->
                        when {
                            event is RoomEvent.TrackSubscribed && event.track is VideoTrack -> {
                                remoteVideo = event.track as VideoTrack
                                renderer?.get()?.let(remoteVideo!!::addRenderer)
                                _state.value = _state.value.copy(remoteVideoAvailable = true)
                            }
                            event is RoomEvent.TrackUnsubscribed && event.track === remoteVideo -> {
                                renderer?.get()?.let { remoteVideo?.removeRenderer(it) }
                                remoteVideo = null
                                _state.value = _state.value.copy(remoteVideoAvailable = false)
                            }
                            event is RoomEvent.Disconnected -> {
                                renderer?.get()?.let { remoteVideo?.removeRenderer(it) }
                                remoteVideo = null
                                if (room === newRoom) room = null
                                _state.value = _state.value.copy(
                                    phase = LiveCallPhase.ENDED,
                                    remoteVideoAvailable = false,
                                    microphonePublished = false,
                                    cameraPublished = false,
                                    message = "媒体连接已断开",
                                )
                                eventJob?.cancel()
                            }
                            event is RoomEvent.FailedToConnect -> {
                                if (room === newRoom) room = null
                                _state.value = _state.value.copy(
                                    phase = LiveCallPhase.ERROR,
                                    message = "音视频连接失败",
                                )
                                eventJob?.cancel()
                            }
                        }
                    }
                }
                newRoom.connect(ticket.url, ticket.token)
                val publishMicrophone = when (side) {
                    CallSide.FAMILY -> ticket.media.sendFamilyAudio
                    CallSide.DEVICE -> ticket.media.receiveDeviceAudio
                }
                val publishCamera = when (side) {
                    CallSide.FAMILY -> ticket.media.sendFamilyVideo
                    CallSide.DEVICE -> ticket.media.receiveDeviceVideo
                }
                newRoom.localParticipant.setMicrophoneEnabled(publishMicrophone)
                newRoom.localParticipant.setCameraEnabled(publishCamera)
                _state.value = _state.value.copy(
                    phase = LiveCallPhase.CONNECTED,
                    microphonePublished = publishMicrophone,
                    cameraPublished = publishCamera,
                    message = "通话中（不录制、不转写）",
                )
            }.onFailure { error ->
                if (error is CancellationException) return@onFailure
                disconnect("connect_failed")
                _state.value = LiveCallState(
                    phase = LiveCallPhase.ERROR,
                    sessionId = ticket.sessionId,
                    message = error.message ?: "音视频连接失败",
                )
            }
        }
        connectJob = job
        job.invokeOnCompletion {
            if (connectJob === job) connectJob = null
        }
    }

    fun attachRenderer(view: SurfaceViewRenderer) {
        renderer?.get()?.let(::detachRenderer)
        renderer = WeakReference(view)
        room?.initVideoRenderer(view)
        remoteVideo?.addRenderer(view)
    }

    fun detachRenderer(view: SurfaceViewRenderer) {
        remoteVideo?.removeRenderer(view)
        if (renderer?.get() === view) renderer = null
        runCatching { view.release() }
    }

    fun disconnect(reason: String = "user_ended") {
        connectJob?.cancel()
        connectJob = null
        eventJob?.cancel()
        eventJob = null
        renderer?.get()?.let { view -> remoteVideo?.removeRenderer(view) }
        remoteVideo = null
        renderer = null
        room?.let { active ->
            scope.launch {
                runCatching { active.localParticipant.setCameraEnabled(false) }
                runCatching { active.localParticipant.setMicrophoneEnabled(false) }
                runCatching { active.disconnect() }
            }
        }
        room = null
        if (_state.value.phase != LiveCallPhase.IDLE) {
            _state.value = _state.value.copy(
                phase = LiveCallPhase.ENDED,
                remoteVideoAvailable = false,
                microphonePublished = false,
                cameraPublished = false,
                message = if (reason == "user_ended") "通话已结束" else reason,
            )
        }
    }
}
