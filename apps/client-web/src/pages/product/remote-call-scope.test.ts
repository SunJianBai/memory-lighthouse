import { describe, expect, it } from "vitest";
import {
  createRemoteSessionOwner,
  isRemoteSessionTerminal,
  remoteSessionCleanupAction,
} from "./remote-call-scope";

describe("remote call scope ownership", () => {
  it("captures the workspace and binding where the call was created", () => {
    expect(
      createRemoteSessionOwner(
        "household-a:recipient-a",
        "household-a",
        "recipient-a",
        "binding-a",
      ),
    ).toEqual({
      scopeKey: "household-a:recipient-a",
      householdId: "household-a",
      recipientId: "recipient-a",
      bindingId: "binding-a",
    });
  });
});

describe("remote session cleanup", () => {
  it("cancels a ringing session and ends every other open session", () => {
    expect(remoteSessionCleanupAction("RINGING")).toBe("cancel");
    for (const status of ["ACCEPTED", "CONNECTING", "ACTIVE", "ENDING"]) {
      expect(remoteSessionCleanupAction(status)).toBe("end");
    }
  });

  it("does nothing for absent or terminal sessions", () => {
    expect(remoteSessionCleanupAction(null)).toBeNull();
    for (const status of [
      "DECLINED",
      "CANCELLED",
      "ENDED",
      "EXPIRED",
      "FAILED",
      "REVOKED",
    ]) {
      expect(isRemoteSessionTerminal(status)).toBe(true);
      expect(remoteSessionCleanupAction(status)).toBeNull();
    }
  });
});
