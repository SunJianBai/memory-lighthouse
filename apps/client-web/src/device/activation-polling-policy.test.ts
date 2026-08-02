import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../api/api-client";
import {
  ACTIVATION_TERMINAL_STATUSES,
  ActivationPollingRetryBudget,
  activationPollingRetryDelayMillis,
  activationTerminalMessage,
  shouldPreserveActivationChallenge,
} from "./activation-polling-policy";
import { DeviceCredentialPersistenceError } from "./device-storage-error";

describe("activation polling policy", () => {
  it("treats every server terminal state as a user-visible stop", () => {
    expect([...ACTIVATION_TERMINAL_STATUSES]).toEqual([
      "CANCELLED",
      "EXPIRED",
      "ATTEMPTS_EXCEEDED",
    ]);
    for (const status of ACTIVATION_TERMINAL_STATUSES) {
      expect(activationTerminalMessage(status)).not.toBe("");
    }
  });

  it("retries only network and explicitly transient API failures", () => {
    const budget = new ActivationPollingRetryBudget();
    expect(budget.shouldRetry(new NetworkError())).toBe(true);
    expect(
      budget.shouldRetry(new ApiError(503, { code: "SERVICE_UNAVAILABLE" })),
    ).toBe(true);
    expect(budget.shouldRetry(new ApiError(429, { code: "RATE_LIMITED" }))).toBe(
      true,
    );
    expect(activationPollingRetryDelayMillis(new ApiError(429, {}))).toBe(10_000);
    expect(budget.shouldRetry(new Error("browser key was lost"))).toBe(false);
    expect(
      budget.shouldRetry(new ApiError(400, { code: "ACTIVATION_EXPIRED" })),
    ).toBe(false);
  });

  it("bounds ambiguous recovery conflicts", () => {
    const budget = new ActivationPollingRetryBudget();
    const conflict = () =>
      new ApiError(409, { code: "ACTIVATION_ALREADY_CONSUMED" });

    expect(budget.shouldRetry(conflict())).toBe(true);
    expect(budget.shouldRetry(conflict())).toBe(true);
    expect(budget.shouldRetry(conflict())).toBe(true);
    expect(budget.shouldRetry(conflict())).toBe(true);
    expect(budget.shouldRetry(conflict())).toBe(false);
  });

  it("preserves the recovery handle when browser credential commit fails", () => {
    const error = new DeviceCredentialPersistenceError(
      new DOMException("commit aborted", "AbortError"),
    );

    expect(shouldPreserveActivationChallenge(error)).toBe(true);
    expect(new ActivationPollingRetryBudget().shouldRetry(error)).toBe(false);
  });
});
