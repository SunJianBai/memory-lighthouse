export type WorkspaceScopeIdentity = {
  key: string;
  epoch: number;
};

export type WorkspaceOperationOwner = Readonly<{
  scopeKey: string;
  householdId: string;
  recipientId: string;
}>;

export const workspaceScopeKey = (
  householdId: string,
  recipientId = "",
): string => `${householdId}:${recipientId}`;

export const createWorkspaceOperationOwner = (
  scopeKey: string,
  householdId: string,
  recipientId: string,
): WorkspaceOperationOwner => ({ scopeKey, householdId, recipientId });

export const isWorkspaceOperationOwnerCurrent = (
  owner: WorkspaceOperationOwner | null,
  currentScopeKey: string,
): owner is WorkspaceOperationOwner => owner?.scopeKey === currentScopeKey;

export class WorkspaceScopeTracker {
  private identity: WorkspaceScopeIdentity = { key: "", epoch: 0 };

  observe(key: string): WorkspaceScopeIdentity {
    if (key !== this.identity.key) {
      this.identity = { key, epoch: this.identity.epoch + 1 };
    }
    return this.identity;
  }
}

export type ScopedRequestToken = Readonly<{
  scopeKey: string;
  epoch: number;
}>;

export class LatestScopedRequest {
  private epoch = 0;
  private current: ScopedRequestToken | null = null;

  begin(scopeKey: string): ScopedRequestToken {
    this.current = { scopeKey, epoch: ++this.epoch };
    return this.current;
  }

  invalidate(): void {
    this.epoch += 1;
    this.current = null;
  }

  isCurrent(token: ScopedRequestToken): boolean {
    return (
      this.current?.scopeKey === token.scopeKey &&
      this.current.epoch === token.epoch
    );
  }
}
