import { describe, expect, it, vi } from "vitest";
import { ActivationExchangeGate } from "./activation-exchange-gate";

describe("ActivationExchangeGate", () => {
  it("releases the gate after a transient failure so the approved exchange can retry", async () => {
    const gate = new ActivationExchangeGate();
    const transientFailure = new Error("network unavailable");
    const action = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(transientFailure)
      .mockResolvedValueOnce();

    await expect(gate.run(action)).rejects.toBe(transientFailure);
    await expect(gate.run(action)).resolves.toBe("completed");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent polls and completed exchanges single-flight", async () => {
    const gate = new ActivationExchangeGate();
    let finish: (() => void) | undefined;
    const first = gate.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    await expect(gate.run(vi.fn())).resolves.toBe("skipped");
    finish?.();
    await expect(first).resolves.toBe("completed");
    await expect(gate.run(vi.fn())).resolves.toBe("skipped");
  });

  it("cannot be reset while an exchange is still running", async () => {
    const gate = new ActivationExchangeGate();
    let finish: (() => void) | undefined;
    const exchange = gate.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    expect(gate.reset()).toBe(false);
    await expect(gate.run(vi.fn())).resolves.toBe("skipped");
    finish?.();
    await expect(exchange).resolves.toBe("completed");

    expect(gate.reset()).toBe(true);
    await expect(gate.run(async () => undefined)).resolves.toBe("completed");
  });
});
