export type CompanionStartStaleReason =
  | "PAGE_UNMOUNTED"
  | "START_SUPERSEDED";

export class CompanionStartCancelledError extends Error {
  constructor(readonly reason: CompanionStartStaleReason) {
    super("陪伴会话启动已取消");
    this.name = "CompanionStartCancelledError";
  }
}

export const isCompanionStartCancelledError = (
  error: unknown,
): error is CompanionStartCancelledError =>
  error instanceof CompanionStartCancelledError;

export class CompanionStartLifecycle {
  private mounted = true;
  private generation = 0;

  mount(): void {
    this.mounted = true;
    this.generation += 1;
  }

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(generation: number): boolean {
    return this.mounted && generation === this.generation;
  }

  staleReason(generation: number): CompanionStartStaleReason | undefined {
    if (!this.mounted) return "PAGE_UNMOUNTED";
    if (generation !== this.generation) return "START_SUPERSEDED";
    return undefined;
  }

  unmount(): void {
    this.mounted = false;
    this.generation += 1;
  }
}

type CompanionSessionResource = { session: { id: string } };

type StartCompanionResourcesOptions<
  Started extends CompanionSessionResource,
  Model,
> = {
  lifecycle: CompanionStartLifecycle;
  startCompanion: () => Promise<Started>;
  startModel: (companionSessionId: string) => Promise<Model>;
  endCompanion: (companionSessionId: string, reason: string) => Promise<unknown>;
  onSessionAvailable?: (companionSessionId: string) => void;
  onSessionEnded?: (companionSessionId: string) => void;
};

export const startCompanionResources = async <
  Started extends CompanionSessionResource,
  Model,
>({
  lifecycle,
  startCompanion,
  startModel,
  endCompanion,
  onSessionAvailable,
  onSessionEnded,
}: StartCompanionResourcesOptions<Started, Model>): Promise<{
  started: Started;
  model: Model;
  generation: number;
}> => {
  const generation = lifecycle.begin();
  let started: Started;
  try {
    started = await startCompanion();
  } catch (error) {
    const staleReason = lifecycle.staleReason(generation);
    if (staleReason) throw new CompanionStartCancelledError(staleReason);
    throw error;
  }

  const sessionId = started.session.id;
  const cancelStaleStart = async (
    reason: CompanionStartStaleReason,
  ): Promise<never> => {
    try {
      await endCompanion(sessionId, reason);
    } catch {
      // The cancellation remains authoritative; server expiry is the fallback.
    } finally {
      onSessionEnded?.(sessionId);
    }
    throw new CompanionStartCancelledError(reason);
  };

  const staleAfterCompanion = lifecycle.staleReason(generation);
  if (staleAfterCompanion) return cancelStaleStart(staleAfterCompanion);
  onSessionAvailable?.(sessionId);

  let model: Model;
  try {
    model = await startModel(sessionId);
  } catch (error) {
    const staleReason = lifecycle.staleReason(generation);
    if (staleReason) return cancelStaleStart(staleReason);
    try {
      await endCompanion(sessionId, "MODEL_START_FAILED");
    } catch {
      // Preserve the model-start error; server expiry remains the fallback.
    } finally {
      onSessionEnded?.(sessionId);
    }
    throw error;
  }

  const staleAfterModel = lifecycle.staleReason(generation);
  if (staleAfterModel) return cancelStaleStart(staleAfterModel);
  return { started, model, generation };
};
