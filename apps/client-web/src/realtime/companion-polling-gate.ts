import type { RemoteSessionView } from "../api/types";

export type CompanionPollingResult = "completed" | "skipped" | "stale";
export type CompanionPollingOwner = () => boolean;

/**
 * Serializes one polling lane while still allowing a replaced effect to start
 * a new epoch immediately. Superseded transports remain tracked so a server
 * mutation boundary can pause and drain every request before it proceeds.
 */
export class CompanionPollingGate {
  private epoch = 0;
  private activeToken: symbol | null = null;
  private pauseCount = 0;
  private readonly inFlight = new Set<Promise<void>>();
  private mutationTail: Promise<void> = Promise.resolve();

  async run(
    action: (isCurrent: CompanionPollingOwner) => Promise<void>,
  ): Promise<CompanionPollingResult> {
    if (this.pauseCount > 0 || this.activeToken !== null) return "skipped";

    const epoch = this.epoch;
    const token = Symbol("companion-poll");
    this.activeToken = token;

    let settle!: () => void;
    const completion = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.inFlight.add(completion);

    const isCurrent = () =>
      this.epoch === epoch && this.activeToken === token;

    try {
      await action(isCurrent);
      return isCurrent() ? "completed" : "stale";
    } catch (error) {
      if (!isCurrent()) return "stale";
      throw error;
    } finally {
      if (this.activeToken === token) this.activeToken = null;
      this.inFlight.delete(completion);
      settle();
    }
  }

  invalidate(): void {
    this.epoch += 1;
    this.activeToken = null;
  }

  async pauseWhile<T>(action: () => Promise<T>): Promise<T> {
    this.pauseCount += 1;
    const run = this.mutationTail.catch(() => undefined).then(async () => {
      while (this.inFlight.size > 0) {
        await Promise.all([...this.inFlight]);
      }
      return action();
    });
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await run;
    } finally {
      this.pauseCount -= 1;
    }
  }
}

const terminalRemoteStatuses = new Set([
  "DECLINED",
  "CANCELLED",
  "ENDED",
  "EXPIRED",
  "FAILED",
  "REVOKED",
]);

export type CompanionRemoteDecision = "show" | "hide" | "stale";

type RemoteStamp = Pick<RemoteSessionView, "id" | "requestedAt" | "version">;

const compareSessionOrder = (candidate: RemoteStamp, current: RemoteStamp) => {
  if (candidate.id === current.id) return candidate.version - current.version;

  const candidateTime = Date.parse(candidate.requestedAt);
  const currentTime = Date.parse(current.requestedAt);
  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    const timeOrder = candidateTime - currentTime;
    if (timeOrder !== 0) return timeOrder;
  } else {
    const timeOrder = candidate.requestedAt.localeCompare(current.requestedAt);
    if (timeOrder !== 0) return timeOrder;
  }
  return candidate.id.localeCompare(current.id);
};

/** Keeps HTTP, push, and command snapshots from moving the visible call back. */
export class CompanionRemoteSessionOwner {
  private latest: RemoteSessionView | null = null;
  private visibleSessionId: string | null = null;
  private readonly hiddenSessionIds = new Set<string>();

  observe(session: RemoteSessionView | null): CompanionRemoteDecision {
    if (session === null) {
      if (this.latest) this.hiddenSessionIds.add(this.latest.id);
      this.visibleSessionId = null;
      return "hide";
    }

    if (this.hiddenSessionIds.has(session.id)) return "stale";
    if (this.latest && compareSessionOrder(session, this.latest) < 0) {
      return "stale";
    }

    this.latest = session;
    if (terminalRemoteStatuses.has(session.status)) {
      this.hiddenSessionIds.add(session.id);
      this.visibleSessionId = null;
      return "hide";
    }
    this.visibleSessionId = session.id;
    return "show";
  }

  isVisible(sessionId: string): boolean {
    return this.visibleSessionId === sessionId;
  }

  currentVisibleSessionId(): string | null {
    return this.visibleSessionId;
  }

  invalidate(): void {
    if (this.latest) this.hiddenSessionIds.add(this.latest.id);
    this.visibleSessionId = null;
  }
}

export type CompanionRemoteMediaResult = "connected" | "stale";

export type CompanionRemoteCommandLease = {
  isCurrent: () => boolean;
  finish: () => void;
};

/** Gives one mounted page exclusive ownership of a remote-call command. */
export class CompanionRemoteCommandGate {
  private epoch = 0;
  private activeToken: symbol | null = null;
  private mounted = true;

  begin(): CompanionRemoteCommandLease | null {
    if (!this.mounted || this.activeToken !== null) return null;
    const epoch = this.epoch;
    const token = Symbol("companion-remote-command");
    this.activeToken = token;
    let finished = false;

    return {
      isCurrent: () =>
        !finished &&
        this.mounted &&
        this.epoch === epoch &&
        this.activeToken === token,
      finish: () => {
        if (finished) return;
        finished = true;
        if (this.activeToken === token) this.activeToken = null;
      },
    };
  }

  mount(): void {
    this.epoch += 1;
    this.activeToken = null;
    this.mounted = true;
  }

  close(): void {
    this.epoch += 1;
    this.activeToken = null;
    this.mounted = false;
  }
}

type MediaRelease = {
  released: boolean;
  completion: Promise<void>;
};

/** Serializes connect/disconnect so replacement media cannot be torn down by A. */
export class CompanionRemoteMediaCoordinator {
  private generation = 0;
  private sessionId: string | null = null;
  private tail: Promise<void> = Promise.resolve();
  private cleanupRequired = false;

  currentSessionId(): string | null {
    return this.sessionId;
  }

  connect<State>(
    sessionId: string,
    isSessionCurrent: () => boolean,
    connectMedia: (
      publish: (state: State, detail?: string) => void,
    ) => Promise<void>,
    publish: (state: State, detail?: string) => void,
    disconnectMedia: () => Promise<void>,
  ): Promise<CompanionRemoteMediaResult> {
    this.generation += 1;
    const generation = this.generation;
    this.sessionId = sessionId;
    const isOwner = () =>
      this.generation === generation &&
      this.sessionId === sessionId &&
      isSessionCurrent();

    return this.enqueue(async () => {
      if (!isOwner()) return "stale";
      if (this.cleanupRequired) {
        try {
          await this.runDisconnect(disconnectMedia);
        } catch (error) {
          if (!isOwner()) return "stale";
          this.generation += 1;
          this.sessionId = null;
          throw error;
        }
        if (!isOwner()) return "stale";
      }
      try {
        await connectMedia((state, detail) => {
          if (isOwner()) publish(state, detail);
        });
      } catch (error) {
        if (!isOwner()) return "stale";
        this.generation += 1;
        this.sessionId = null;
        try {
          await this.runDisconnect(disconnectMedia);
        } catch {
          // Preserve the connection failure while still attempting cleanup.
        }
        throw error;
      }
      return isOwner() ? "connected" : "stale";
    });
  }

  releaseExcept(
    nextSessionId: string | null,
    disconnectMedia: () => Promise<void>,
  ): MediaRelease {
    const ownedSessionId = this.sessionId;
    if (!ownedSessionId || ownedSessionId === nextSessionId) {
      return { released: false, completion: Promise.resolve() };
    }
    return this.releaseOwned(ownedSessionId, disconnectMedia);
  }

  release(
    expectedSessionId: string,
    disconnectMedia: () => Promise<void>,
  ): MediaRelease {
    if (this.sessionId !== expectedSessionId) {
      return { released: false, completion: Promise.resolve() };
    }
    return this.releaseOwned(expectedSessionId, disconnectMedia);
  }

  releaseAll(disconnectMedia: () => Promise<void>): MediaRelease {
    const released = this.sessionId !== null;
    this.generation += 1;
    this.sessionId = null;
    return {
      released,
      completion: this.enqueue(() => this.runDisconnect(disconnectMedia)),
    };
  }

  private releaseOwned(
    expectedSessionId: string,
    disconnectMedia: () => Promise<void>,
  ): MediaRelease {
    if (this.sessionId !== expectedSessionId) {
      return { released: false, completion: Promise.resolve() };
    }
    this.generation += 1;
    this.sessionId = null;
    return {
      released: true,
      completion: this.enqueue(() => this.runDisconnect(disconnectMedia)),
    };
  }

  private async runDisconnect(disconnectMedia: () => Promise<void>) {
    try {
      await disconnectMedia();
      this.cleanupRequired = false;
    } catch (error) {
      this.cleanupRequired = true;
      throw error;
    }
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(action);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
