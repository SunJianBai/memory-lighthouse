import { describe, expect, it } from "vitest";
import {
  presentFamilyCall,
  shouldDisconnectFamilyMedia,
} from "./family-call-presentation";

describe("family call presentation", () => {
  it.each(["error", "disconnected"] as const)(
    "treats accepted media status %s as a terminal retry boundary",
    (mediaStatus) => {
      expect(presentFamilyCall("ACCEPTED", mediaStatus)).toMatchObject({
        state: "media-failed",
        tone: "error",
        canJoin: false,
        message: expect.stringContaining("不能直接重连"),
      });
    },
  );

  it("does not allow joining before onsite acceptance", () => {
    expect(presentFamilyCall("RINGING", "idle")).toMatchObject({
      state: "ringing",
      canJoin: false,
      message: expect.stringContaining("未接听前不会打开"),
    });
  });

  it("allows one initial join after onsite acceptance", () => {
    expect(presentFamilyCall("CONNECTING", "idle")).toMatchObject({
      state: "accepted",
      canJoin: true,
      message: expect.stringContaining("陪伴模型已停止"),
    });
  });

  it("keeps an accepted media failure visible after the server ends the session", () => {
    expect(presentFamilyCall("ENDED", "disconnected", true)).toMatchObject({
      state: "media-failed",
      canJoin: false,
    });
  });

  it("releases local media whenever the server reaches a terminal state", () => {
    expect(shouldDisconnectFamilyMedia("ENDED")).toBe(true);
    expect(shouldDisconnectFamilyMedia("FAILED")).toBe(true);
    expect(shouldDisconnectFamilyMedia("ACTIVE")).toBe(false);
    expect(shouldDisconnectFamilyMedia(undefined)).toBe(false);
  });
});
