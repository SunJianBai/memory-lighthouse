import {
  createWorkspaceOperationOwner,
  type WorkspaceOperationOwner,
} from "../../workspace/workspace-scope";

export type RemoteSessionOwner = WorkspaceOperationOwner &
  Readonly<{ bindingId: string }>;

const terminalRemoteStatuses = new Set([
  "DECLINED",
  "CANCELLED",
  "ENDED",
  "EXPIRED",
  "FAILED",
  "REVOKED",
]);

export const createRemoteSessionOwner = (
  scopeKey: string,
  householdId: string,
  recipientId: string,
  bindingId: string,
): RemoteSessionOwner => ({
  ...createWorkspaceOperationOwner(scopeKey, householdId, recipientId),
  bindingId,
});

export const isRemoteSessionTerminal = (status: string): boolean =>
  terminalRemoteStatuses.has(status);

export const remoteSessionCleanupAction = (
  status: string | null | undefined,
): "cancel" | "end" | null => {
  if (!status || isRemoteSessionTerminal(status)) return null;
  return status === "RINGING" ? "cancel" : "end";
};
