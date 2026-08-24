import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import type { RemoteJoinTicketView, RemoteSessionView } from "../api/types";

export type LiveMediaRole = "FAMILY" | "DEVICE";
export type LiveMediaStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export type LiveMediaTargets = {
  remoteVideo?: HTMLVideoElement | null;
  remoteAudio?: HTMLAudioElement | null;
  localVideo?: HTMLVideoElement | null;
};

export class LiveMediaConnection {
  private room: Room | null = null;

  constructor(
    private readonly createRoom: () => Room = () =>
      new Room({ adaptiveStream: true, dynacast: true }),
  ) {}

  async connect(
    ticket: RemoteJoinTicketView,
    role: LiveMediaRole,
    targets: LiveMediaTargets,
    onStatus: (status: LiveMediaStatus, detail?: string) => void,
  ): Promise<void> {
    await this.disconnect();
    onStatus("connecting");
    const room = this.createRoom();
    this.room = room;

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Video && targets.remoteVideo) {
          track.attach(targets.remoteVideo);
        }
        if (track.kind === Track.Kind.Audio && targets.remoteAudio) {
          track.attach(targets.remoteAudio);
        }
      },
    );
    room.on(RoomEvent.Disconnected, () => onStatus("disconnected", "媒体连接已断开"));
    room.on(RoomEvent.Reconnecting, () => onStatus("connecting", "网络波动，正在重连"));
    room.on(RoomEvent.Reconnected, () => onStatus("connected", "媒体连接已恢复"));

    try {
      await room.connect(ticket.url, ticket.token);
      const publishMicrophone = role === "FAMILY"
        ? ticket.media.sendFamilyAudio
        : ticket.media.receiveDeviceAudio;
      const publishCamera = role === "DEVICE" && ticket.media.receiveDeviceVideo;
      if (publishMicrophone) await room.localParticipant.setMicrophoneEnabled(true);
      if (publishCamera) {
        await room.localParticipant.setCameraEnabled(true);
        const publication = [...room.localParticipant.videoTrackPublications.values()][0];
        if (publication?.videoTrack && targets.localVideo) {
          publication.videoTrack.attach(targets.localVideo);
        }
      }
      onStatus("connected", "LiveKit 媒体已连接，等待服务器 Webhook 确认双方轨道");
    } catch (error) {
      try {
        await this.disconnect();
      } catch {
        // disconnect() has already stopped local tracks and retains the Room so
        // an owner-scoped cleanup barrier can retry the transport teardown.
      }
      onStatus("error", error instanceof Error ? error.message : "LiveKit 连接失败");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    if (!room) return;
    room.remoteParticipants.forEach((participant: RemoteParticipant) => {
      participant.trackPublications.forEach((publication: RemoteTrackPublication) => publication.track?.detach());
    });
    room.localParticipant.trackPublications.forEach((publication: LocalTrackPublication) => {
      publication.track?.detach();
      publication.track?.stop();
    });
    await room.disconnect();
    if (this.room === room) this.room = null;
  }
}

export type RemoteSignal = {
  type: "remote-session.requested";
  session: RemoteSessionView;
};

export class BrowserRemoteSignalAdapter {
  private channel: BroadcastChannel | null = null;

  constructor() {
    if ("BroadcastChannel" in window) {
      this.channel = new BroadcastChannel("memory-lighthouse.remote-signal.v1");
    }
  }

  publish(signal: RemoteSignal): void {
    this.channel?.postMessage(signal);
  }

  subscribe(listener: (signal: RemoteSignal) => void): () => void {
    if (!this.channel) return () => undefined;
    const handler = (event: MessageEvent<RemoteSignal>) => {
      if (event.data?.type === "remote-session.requested") listener(event.data);
    };
    this.channel.addEventListener("message", handler);
    return () => this.channel?.removeEventListener("message", handler);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
  }
}
