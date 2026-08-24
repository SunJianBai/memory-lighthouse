import {
  createWorkspaceOperationOwner,
  type WorkspaceOperationOwner,
  type WorkspaceScopeIdentity,
} from "../../workspace/workspace-scope";

export type ScopedPageState<T> = Readonly<{
  scopeKey: string;
  value: T;
}>;

export type ScopedMutationOwner = WorkspaceOperationOwner &
  Readonly<{
    scopeEpoch: number;
  }>;

export const createScopedMutationOwner = (
  scope: WorkspaceScopeIdentity,
  householdId: string,
  recipientId: string,
): ScopedMutationOwner => ({
  ...createWorkspaceOperationOwner(scope.key, householdId, recipientId),
  scopeEpoch: scope.epoch,
});

export const isScopedMutationOwnerCurrent = (
  owner: ScopedMutationOwner | null,
  currentScope: WorkspaceScopeIdentity,
): owner is ScopedMutationOwner =>
  owner?.scopeKey === currentScope.key &&
  owner.scopeEpoch === currentScope.epoch;

export const createScopedPageState = <T>(
  scopeKey: string,
  value: T,
): ScopedPageState<T> => ({ scopeKey, value });

export const pageValueForScope = <T>(
  state: ScopedPageState<T>,
  currentScopeKey: string,
  emptyValue: T,
): T => (state.scopeKey === currentScopeKey ? state.value : emptyValue);
