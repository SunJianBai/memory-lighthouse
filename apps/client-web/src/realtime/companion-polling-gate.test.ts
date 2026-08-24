import { describe, expect, it, vi } from "vitest";
import type { RemoteSessionView } from "../api/types";
import {
  CompanionPollingGate,
  CompanionRemoteCommandGate,
  CompanionRemoteMediaCoordinator,
  CompanionRemoteSessionOwner,
} from "./companion-polling-gate";
import { guardActiveCompanionHeartbeat } from "./remote-answer-handoff";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const remote = (
  id: string,
  version: number,
  requestedAt: string,
  status = "RINGING",
): RemoteSessionView => ({
  id,
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
  requestedAt,
  acceptedAt: null,
  connectedAt: null,
  endedAt: null,
  endReason: null,
  version,
});

describe("CompanionPollingGate", () => {
  it("keeps each polling lane single-flight and releases it after success", async () => {
    const gate = new CompanionPollingGate();
    const pending = deferred<void>();
    const transport = vi.fn(async () => pending.promise);

    const first = gate.run(async () => transport());
    await expect(gate.run(async () => transport())).resolves.toBe("skipped");
    expect(transport).toHaveBeenCalledTimes(1);

    pending.resolve();
    await expect(first).resolves.toBe("completed");
    await expect(gate.run(async () => transport())).resolves.toBe("completed");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("propagates a current failure and releases the lane for retry", async () => {
    const gate = new CompanionPollingGate();
    const failure = new Error("offline");

    await expect(gate.run(async () => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    await expect(gate.run(async () => undefined)).resolves.toBe("completed");
  });

  it("discards stale success and failure without clearing the new epoch", async () => {
    const gate = new CompanionPollingGate();
    const oldSuccess = deferred<void>();
    const oldFailure = deferred<void>();
    const current = deferred<void>();
    const staleEffect = vi.fn();

    const first = gate.run(async (isCurrent) => {
      await oldSuccess.promise;
      if (isCurrent()) staleEffect();
    });
    gate.invalidate();
    const second = gate.run(async () => current.promise);

    oldSuccess.resolve();
    await expect(first).resolves.toBe("stale");
    await expect(gate.run(async () => undefined)).resolves.toBe("skipped");
    expect(staleEffect).not.toHaveBeenCalled();

    current.resolve();
    await expect(second).resolves.toBe("completed");

    const third = gate.run(async () => oldFailure.promise);
    gate.invalidate();
    oldFailure.reject(new Error("stale failure"));
    await expect(third).resolves.toBe("stale");
  });

  it("pauses new ticks and drains every superseded transport before a mutation", async () => {
    const gate = new CompanionPollingGate();
    const oldTransport = deferred<void>();
    const newerTransport = deferred<void>();
    const mutationBody = deferred<void>();
    const order: string[] = [];

    const oldPoll = gate.run(async () => oldTransport.promise);
    gate.invalidate();
    const newPoll = gate.run(async () => newerTransport.promise);
    const mutation = gate.pauseWhile(async () => {
      order.push("mutation");
      await mutationBody.promise;
    });

    await expect(
      gate.run(async () => {
        order.push("unexpected");
      }),
    ).resolves.toBe("skipped");
    await Promise.resolve();
    expect(order).toEqual([]);

    oldTransport.resolve();
    await expect(oldPoll).resolves.toBe("stale");
    await Promise.resolve();
    expect(order).toEqual([]);

    newerTransport.resolve();
    await expect(newPoll).resolves.toBe("completed");
    await vi.waitFor(() => expect(order).toEqual(["mutation"]));
    await expect(gate.run(async () => undefined)).resolves.toBe("skipped");

    mutationBody.resolve();
    await mutation;
    expect(order).toEqual(["mutation"]);
    await expect(gate.run(async () => undefined)).resolves.toBe("completed");
  });

  it("serializes concurrent mutations while keeping polling paused", async () => {
    const gate = new CompanionPollingGate();
    const first = deferred<void>();
    const order: string[] = [];

    const firstMutation = gate.pauseWhile(async () => {
      order.push("first-start");
      await first.promise;
      order.push("first-end");
    });
    const secondMutation = gate.pauseWhile(async () => {
      order.push("second");
    });

    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    await expect(gate.run(async () => undefined)).resolves.toBe("skipped");
    first.resolve();

    await Promise.all([firstMutation, secondMutation]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("suppresses a stale active-session heartbeat failure before fail-closed side effects", async () => {
    const gate = new CompanionPollingGate();
    const heartbeat = deferred<void>();
    const stopLocalRuntime = vi.fn();

    const oldPoll = gate.run(async (isCurrent) => {
      await guardActiveCompanionHeartbeat(
        heartbeat.promise,
        "companion-a",
        stopLocalRuntime,
        isCurrent,
      );
    });
    gate.invalidate();
    heartbeat.reject(new Error("old credential failure"));

    await expect(oldPoll).resolves.toBe("stale");
    expect(stopLocalRuntime).not.toHaveBeenCalled();
  });

  it("lets a current active-session heartbeat fail closed exactly once", async () => {
    const gate = new CompanionPollingGate();
    const stopLocalRuntime = vi.fn();

    await expect(
      gate.run(async (isCurrent) => {
        await guardActiveCompanionHeartbeat(
          Promise.reject(new Error("credential revoked")),
          "companion-current",
          stopLocalRuntime,
          isCurrent,
        );
      }),
    ).rejects.toThrow("credential revoked");
    expect(stopLocalRuntime).toHaveBeenCalledTimes(1);
  });
});

describe("CompanionRemoteCommandGate", () => {
  it("allows only one command until its lease finishes", () => {
    const gate = new CompanionRemoteCommandGate();
    const first = gate.begin();

    expect(first?.isCurrent()).toBe(true);
    expect(gate.begin()).toBeNull();
    first?.finish();

    expect(first?.isCurrent()).toBe(false);
    expect(gate.begin()?.isCurrent()).toBe(true);
  });

  it("invalidates old leases across a StrictMode close and remount", () => {
    const gate = new CompanionRemoteCommandGate();
    const oldCommand = gate.begin();

    gate.close();

    expect(oldCommand?.isCurrent()).toBe(false);
    expect(gate.begin()).toBeNull();

    gate.mount();
    const replayCommand = gate.begin();
    expect(replayCommand?.isCurrent()).toBe(true);
    expect(oldCommand?.isCurrent()).toBe(false);
  });
});

describe("CompanionRemoteSessionOwner", () => {
  it("rejects older versions and older sessions after a newer snapshot", () => {
    const owner = new CompanionRemoteSessionOwner();
    const sessionA = remote("remote-a", 2, "2026-08-25T00:00:00.000Z");
    const sessionB = remote("remote-b", 1, "2026-08-25T00:01:00.000Z");

    expect(owner.observe(sessionA)).toBe("show");
    expect(
      owner.observe(remote("remote-a", 1, sessionA.requestedAt)),
    ).toBe("stale");
    expect(owner.observe(sessionB)).toBe("show");
    expect(owner.observe(remote("remote-a", 3, sessionA.requestedAt))).toBe(
      "stale",
    );
    expect(owner.isVisible(sessionB.id)).toBe(true);
  });

  it("keeps terminal snapshots as tombstones while hiding the call", () => {
    const owner = new CompanionRemoteSessionOwner();
    const requestedAt = "2026-08-25T00:00:00.000Z";

    expect(owner.observe(remote("remote-a", 1, requestedAt))).toBe("show");
    expect(owner.observe(remote("remote-a", 3, requestedAt, "ENDED"))).toBe(
      "hide",
    );
    expect(owner.isVisible("remote-a")).toBe(false);
    expect(owner.observe(remote("remote-a", 2, requestedAt, "ACTIVE"))).toBe(
      "stale",
    );
  });

  it("does not resurrect the last visible call after an authoritative null", () => {
    const owner = new CompanionRemoteSessionOwner();
    const requestedAt = "2026-08-25T00:00:00.000Z";

    expect(owner.observe(remote("remote-a", 4, requestedAt, "ACTIVE"))).toBe(
      "show",
    );
    expect(owner.observe(null)).toBe("hide");
    expect(owner.observe(remote("remote-a", 4, requestedAt, "ACTIVE"))).toBe(
      "stale",
    );
    expect(owner.observe(remote("remote-a", 5, requestedAt, "ACTIVE"))).toBe(
      "stale",
    );
  });

  it("invalidates the visible owner so an unmounted command cannot revive it", () => {
    const owner = new CompanionRemoteSessionOwner();
    const requestedAt = "2026-08-25T00:00:00.000Z";

    expect(owner.observe(remote("remote-a", 1, requestedAt))).toBe("show");
    owner.invalidate();

    expect(owner.isVisible("remote-a")).toBe(false);
    expect(owner.observe(remote("remote-a", 2, requestedAt, "ACCEPTED"))).toBe(
      "stale",
    );
  });

  it("combines discovery invalidation and snapshot ordering to protect newer media", async () => {
    const gate = new CompanionPollingGate();
    const owner = new CompanionRemoteSessionOwner();
    const oldDiscovery = deferred<RemoteSessionView | null>();
    const disconnect = vi.fn(async () => undefined);
    const newer = remote(
      "remote-b",
      1,
      "2026-08-25T00:01:00.000Z",
      "ACTIVE",
    );

    const poll = gate.run(async (isCurrent) => {
      const current = await oldDiscovery.promise;
      if (!isCurrent()) return;
      const decision = owner.observe(current);
      if (decision === "hide") await disconnect();
    });

    gate.invalidate();
    expect(owner.observe(newer)).toBe("show");
    oldDiscovery.resolve(null);

    await expect(poll).resolves.toBe("stale");
    expect(owner.isVisible(newer.id)).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
  });
});

describe("CompanionRemoteMediaCoordinator", () => {
  it("queues an owner-scoped disconnect behind an in-flight stale connect", async () => {
    const coordinator = new CompanionRemoteMediaCoordinator();
    const connection = deferred<void>();
    const order: string[] = [];
    const publish = vi.fn();

    const connecting = coordinator.connect(
      "remote-a",
      () => true,
      async (publishState) => {
        order.push("connect-a");
        publishState("connecting");
        await connection.promise;
        publishState("connected");
        order.push("connected-a");
      },
      publish,
      async () => {
        order.push("cleanup-a-error");
      },
    );
    await vi.waitFor(() => expect(order).toEqual(["connect-a"]));

    const release = coordinator.releaseExcept("remote-b", async () => {
      order.push("disconnect-a");
    });
    expect(release.released).toBe(true);
    expect(coordinator.currentSessionId()).toBeNull();

    connection.resolve();
    await expect(connecting).resolves.toBe("stale");
    await release.completion;
    expect(order).toEqual(["connect-a", "connected-a", "disconnect-a"]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("connecting", undefined);
  });

  it("serializes a replacement connection after the old media disconnect", async () => {
    const coordinator = new CompanionRemoteMediaCoordinator();
    const order: string[] = [];

    await expect(
      coordinator.connect(
        "remote-a",
        () => true,
        async () => {
          order.push("connect-a");
        },
        vi.fn(),
        async () => undefined,
      ),
    ).resolves.toBe("connected");

    const release = coordinator.releaseExcept("remote-b", async () => {
      order.push("disconnect-a");
    });
    const replacement = coordinator.connect(
      "remote-b",
      () => true,
      async () => {
        order.push("connect-b");
      },
      vi.fn(),
      async () => undefined,
    );

    await release.completion;
    await expect(replacement).resolves.toBe("connected");
    expect(order).toEqual(["connect-a", "disconnect-a", "connect-b"]);
    expect(coordinator.currentSessionId()).toBe("remote-b");
  });

  it("cleans partial current media while preserving the original connect error", async () => {
    const coordinator = new CompanionRemoteMediaCoordinator();
    const failure = new Error("livekit failed");
    const disconnect = vi.fn(async () => undefined);

    await expect(
      coordinator.connect(
        "remote-a",
        () => true,
        async () => Promise.reject(failure),
        vi.fn(),
        disconnect,
      ),
    ).rejects.toBe(failure);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(coordinator.currentSessionId()).toBeNull();
  });

  it("queues final page cleanup behind a release that already cleared the owner", async () => {
    const coordinator = new CompanionRemoteMediaCoordinator();
    const connection = deferred<void>();
    const order: string[] = [];

    const connecting = coordinator.connect(
      "remote-a",
      () => true,
      async () => {
        order.push("connect-a");
        await connection.promise;
        order.push("connected-a");
      },
      vi.fn(),
      async () => undefined,
    );
    await vi.waitFor(() => expect(order).toEqual(["connect-a"]));

    const terminalRelease = coordinator.releaseExcept(null, async () => {
      order.push("terminal-disconnect");
    });
    const pageCleanup = coordinator.releaseAll(async () => {
      order.push("page-disconnect");
    });
    expect(terminalRelease.released).toBe(true);
    expect(pageCleanup.released).toBe(false);

    connection.resolve();
    await expect(connecting).resolves.toBe("stale");
    await Promise.all([terminalRelease.completion, pageCleanup.completion]);
    expect(order).toEqual([
      "connect-a",
      "connected-a",
      "terminal-disconnect",
      "page-disconnect",
    ]);
  });

  it("blocks replacement media while the failed cleanup retry is still unsafe", async () => {
    const coordinator = new CompanionRemoteMediaCoordinator();
    const cleanupFailure = new Error("room did not disconnect");
    const disconnect = vi.fn(async () => Promise.reject(cleanupFailure));
    const connectReplacement = vi.fn(async () => undefined);

    await expect(
      coordinator.connect(
        "remote-a",
        () => true,
        async () => undefined,
        vi.fn(),
        disconnect,
      ),
    ).resolves.toBe("connected");

    const release = coordinator.releaseExcept("remote-b", disconnect);
    const replacement = coordinator.connect(
      "remote-b",
      () => true,
      connectReplacement,
      vi.fn(),
      disconnect,
    );

    const releaseResult = expect(release.completion).rejects.toBe(
      cleanupFailure,
    );
    const replacementResult = expect(replacement).rejects.toBe(cleanupFailure);
    await Promise.all([releaseResult, replacementResult]);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(connectReplacement).not.toHaveBeenCalled();
    expect(coordinator.currentSessionId()).toBeNull();
  });

  it("connects a replacement only after a failed cleanup retry succeeds", async () => {
    const coordinator = new CompanionRemoteMediaCoordinator();
    const cleanupFailure = new Error("first disconnect failed");
    const disconnect = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(cleanupFailure)
      .mockResolvedValueOnce(undefined);
    const connectReplacement = vi.fn(async () => undefined);

    await coordinator.connect(
      "remote-a",
      () => true,
      async () => undefined,
      vi.fn(),
      disconnect,
    );
    const release = coordinator.releaseExcept("remote-b", disconnect);
    const replacement = coordinator.connect(
      "remote-b",
      () => true,
      connectReplacement,
      vi.fn(),
      disconnect,
    );

    await expect(release.completion).rejects.toBe(cleanupFailure);
    await expect(replacement).resolves.toBe("connected");
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(connectReplacement).toHaveBeenCalledTimes(1);
    expect(coordinator.currentSessionId()).toBe("remote-b");
  });
});
