import { describe, expect, it } from "vitest";
import { presentDeviceCall } from "./device-call-presentation";

describe("device call presentation", () => {
  it("does not claim companionship continues after onsite acceptance", () => {
    expect(presentDeviceCall("ACCEPTED", "connecting")).toMatchObject({
      state: "connecting",
      message: expect.stringContaining("陪伴模型已停止"),
    });
  });

  it("renders an accepted media failure as an error with no retry join", () => {
    expect(presentDeviceCall("CONNECTING", "error")).toMatchObject({
      state: "media-failed",
      callDetailTone: "error",
      canJoin: false,
    });
  });

  it("keeps companionship active only while the call is still ringing", () => {
    expect(presentDeviceCall("RINGING", "idle")).toMatchObject({
      state: "ringing",
      canJoin: true,
      message: expect.stringContaining("陪伴模型继续"),
    });
  });
});
