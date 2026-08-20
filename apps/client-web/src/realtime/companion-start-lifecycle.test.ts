import { describe, expect, it, vi } from "vitest";
import {
  CompanionStartCancelledError,
  CompanionStartLifecycle,
  startCompanionResources,
} from "./companion-start-lifecycle";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("companion session start lifecycle", () => {
  it("ends a late server session by its original id and never starts the model", async () => {
    const lifecycle = new CompanionStartLifecycle();
    const companionResponse = deferred<{ session: { id: string } }>();
    const startModel = vi.fn(async () => ({ session: { id: "model-1" } }));
    const endCompanion = vi.fn(async () => undefined);

    const result = startCompanionResources({
      lifecycle,
      startCompanion: () => companionResponse.promise,
      startModel,
      endCompanion,
    });
    lifecycle.unmount();
    companionResponse.resolve({ session: { id: "late-companion-1" } });

    await expect(result).rejects.toBeInstanceOf(CompanionStartCancelledError);
    expect(endCompanion).toHaveBeenCalledWith(
      "late-companion-1",
      "PAGE_UNMOUNTED",
    );
    expect(startModel).not.toHaveBeenCalled();
  });

  it("ends the exact session when the model response arrives after unmount", async () => {
    const lifecycle = new CompanionStartLifecycle();
    const modelResponse = deferred<{ session: { id: string } }>();
    const endCompanion = vi.fn(async () => undefined);
    const onSessionAvailable = vi.fn();
    let runtimeStarted = false;

    const result = startCompanionResources({
      lifecycle,
      startCompanion: async () => ({ session: { id: "companion-2" } }),
      startModel: () => modelResponse.promise,
      endCompanion,
      onSessionAvailable,
    }).then(() => {
      runtimeStarted = true;
    });
    await vi.waitFor(() => expect(onSessionAvailable).toHaveBeenCalledWith("companion-2"));

    lifecycle.unmount();
    modelResponse.resolve({ session: { id: "model-2" } });

    await expect(result).rejects.toBeInstanceOf(CompanionStartCancelledError);
    expect(endCompanion).toHaveBeenCalledWith("companion-2", "PAGE_UNMOUNTED");
    expect(runtimeStarted).toBe(false);
  });

  it("a newer start generation invalidates the older attempt", () => {
    const lifecycle = new CompanionStartLifecycle();
    const first = lifecycle.begin();
    const second = lifecycle.begin();

    expect(lifecycle.isCurrent(first)).toBe(false);
    expect(lifecycle.staleReason(first)).toBe("START_SUPERSEDED");
    expect(lifecycle.isCurrent(second)).toBe(true);
  });

  it("an explicit stop invalidates an in-flight start without unmounting", () => {
    const lifecycle = new CompanionStartLifecycle();
    const attempt = lifecycle.begin();

    lifecycle.invalidate();

    expect(lifecycle.isCurrent(attempt)).toBe(false);
    expect(lifecycle.staleReason(attempt)).toBe("START_SUPERSEDED");
    expect(lifecycle.isCurrent(lifecycle.begin())).toBe(true);
  });
});
