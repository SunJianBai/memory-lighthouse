import type { Room } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import type { RemoteJoinTicketView } from "../api/types";
import { LiveMediaConnection } from "./live-media";

const ticket: RemoteJoinTicketView = {
  sessionId: "remote-a",
  ticketId: "ticket-a",
  participantId: "participant-a",
  participantIdentity: "device-a",
  url: "wss://livekit.invalid",
  token: "token-a",
  expiresAt: "2026-08-25T01:00:00.000Z",
  media: {
    receiveDeviceAudio: false,
    receiveDeviceVideo: false,
    sendFamilyAudio: false,
    sendFamilyVideo: false,
  },
  recording: false,
  transcription: false,
};

describe("LiveMediaConnection disconnect", () => {
  it("stops local capture and retains a failed Room so cleanup can retry", async () => {
    const failure = new Error("send leave failed");
    const localTrack = {
      detach: vi.fn(),
      stop: vi.fn(),
    };
    const room = {
      on: vi.fn().mockReturnThis(),
      connect: vi.fn(async () => undefined),
      disconnect: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(undefined),
      remoteParticipants: new Map(),
      localParticipant: {
        trackPublications: new Map([
          ["audio", { track: localTrack }],
        ]),
        videoTrackPublications: new Map(),
        setMicrophoneEnabled: vi.fn(async () => undefined),
        setCameraEnabled: vi.fn(async () => undefined),
      },
    };
    const media = new LiveMediaConnection(() => room as unknown as Room);

    await media.connect(ticket, "DEVICE", {}, vi.fn());
    await expect(media.disconnect()).rejects.toBe(failure);
    expect(localTrack.detach).toHaveBeenCalledTimes(1);
    expect(localTrack.stop).toHaveBeenCalledTimes(1);

    await expect(media.disconnect()).resolves.toBeUndefined();
    expect(room.disconnect).toHaveBeenCalledTimes(2);
  });
});
