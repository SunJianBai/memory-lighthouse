import { describe, expect, it, vi } from "vitest";
import type { RemoteSessionView } from "../api/types";
import companionPageSource from "../pages/product/CompanionPage.tsx?raw";
import {
  acceptRemoteWithAuthoritativeHandoff,
  guardActiveCompanionHeartbeat,
  guardCompanionWrite,
  shouldKeepCompanionActive,
  shouldStopForMediaDirective,
} from "./remote-answer-handoff";

const remoteSession = (status: string): RemoteSessionView => ({
  id: "remote-1",
  householdId: "household-1",
  recipientId: "recipient-1",
  bindingId: "binding-1",
  answerMode: "ONSITE_ANSWER",
  media: {
    receiveDeviceAudio: true,
    receiveDeviceVideo: true,
    sendFamilyAudio: true,
    sendFamilyVideo: false,
  },
  status,
  requestedAt: "2026-08-02T00:00:00.000Z",
  acceptedAt: status === "RINGING" ? null : "2026-08-02T00:00:01.000Z",
  connectedAt: null,
  endedAt: null,
  endReason: null,
  version: 1,
});

describe("remote answer handoff", () => {
  it("keeps the companion runtime active while the server says RINGING", () => {
    expect(shouldKeepCompanionActive(null)).toBe(true);
    expect(shouldKeepCompanionActive("RINGING")).toBe(true);
    expect(shouldKeepCompanionActive("ACCEPTED")).toBe(false);
    expect(shouldKeepCompanionActive("ENDED")).toBe(false);
  });

  it("stops only for an explicit heartbeat STOP directive", () => {
    expect(shouldStopForMediaDirective("CONTINUE")).toBe(false);
    expect(shouldStopForMediaDirective("STOP")).toBe(true);
  });

  it("fails closed when the server rejects a companion-session write", async () => {
    const rejection = new Error("consent revoked");
    const stopLocalCompanion = vi.fn();

    const persisted = await guardCompanionWrite(
      Promise.reject(rejection),
      stopLocalCompanion,
    );

    expect(persisted).toBe(false);
    expect(stopLocalCompanion).toHaveBeenCalledWith(rejection);
  });

  it("guards every model event and transcript write in CompanionPage", () => {
    expect(companionPageSource).toMatch(
      /guardActiveCompanionHeartbeat\(\s*deviceSession\.heartbeat/,
    );
    expect(companionPageSource).toMatch(
      /guardCompanionWrite\(\s*deviceSession\.appendModelEvent/,
    );
    expect(companionPageSource).toMatch(
      /guardCompanionWrite\(\s*deviceSession\.appendAssistantUtterance/,
    );
    expect(companionPageSource).toMatch(
      /guardCompanionWrite\(\s*deviceSession\.appendUserTranscript/,
    );
  });

  it("fails closed when an active companion heartbeat cannot authenticate", async () => {
    const rejection = new Error("device credential revoked");
    const stopLocalCompanion = vi.fn();

    await expect(
      guardActiveCompanionHeartbeat(
        Promise.reject(rejection),
        "companion-1",
        stopLocalCompanion,
      ),
    ).rejects.toBe(rejection);

    expect(stopLocalCompanion).toHaveBeenCalledWith(rejection);
  });

  it("does not create a stop request for an idle-device heartbeat failure", async () => {
    const rejection = new Error("offline");
    const stopLocalCompanion = vi.fn();

    await expect(
      guardActiveCompanionHeartbeat(
        Promise.reject(rejection),
        undefined,
        stopLocalCompanion,
      ),
    ).rejects.toBe(rejection);

    expect(stopLocalCompanion).not.toHaveBeenCalled();
  });

  it("accepts on the server before stopping local AI and joining media", async () => {
    const order: string[] = [];
    const accepted = remoteSession("ACCEPTED");
    const accept = vi.fn(async () => {
      order.push("server-accept");
      return accepted;
    });
    const stopLocalCompanion = vi.fn(async () => {
      order.push("stop-local-ai");
    });
    const joinMedia = vi.fn(async () => {
      order.push("join-media");
    });

    const result = await acceptRemoteWithAuthoritativeHandoff({
      session: remoteSession("RINGING"),
      accept,
      stopLocalCompanion,
      joinMedia,
    });

    expect(result).toBe(accepted);
    expect(order).toEqual(["server-accept", "stop-local-ai", "join-media"]);
  });

  it("stops after a terminal authoritative result without joining media", async () => {
    const terminal = remoteSession("EXPIRED");
    const stopLocalCompanion = vi.fn(async () => undefined);
    const joinMedia = vi.fn(async () => undefined);

    const result = await acceptRemoteWithAuthoritativeHandoff({
      session: terminal,
      accept: vi.fn(),
      stopLocalCompanion,
      joinMedia,
    });

    expect(result).toBe(terminal);
    expect(stopLocalCompanion).toHaveBeenCalledWith(terminal);
    expect(joinMedia).not.toHaveBeenCalled();
  });
});
