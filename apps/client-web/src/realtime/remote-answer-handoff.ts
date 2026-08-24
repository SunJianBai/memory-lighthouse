import type { RemoteSessionView } from "../api/types";

const joinableStatuses = new Set(["ACCEPTED", "CONNECTING", "ACTIVE"]);
const terminalStatuses = new Set([
  "DECLINED",
  "CANCELLED",
  "ENDED",
  "EXPIRED",
  "FAILED",
  "REVOKED",
]);

export const shouldKeepCompanionActive = (remoteStatus: string | null) =>
  remoteStatus === null || remoteStatus === "RINGING";

export const shouldStopForMediaDirective = (
  directive: "CONTINUE" | "STOP",
) => directive === "STOP";

export const guardCompanionWrite = async (
  write: Promise<unknown>,
  stopLocalCompanion: (error: unknown) => void,
) => {
  try {
    await write;
    return true;
  } catch (error) {
    stopLocalCompanion(error);
    return false;
  }
};

export const guardActiveCompanionHeartbeat = async <T>(
  heartbeat: Promise<T>,
  activeCompanionSessionId: string | undefined,
  stopLocalCompanion: (error: unknown) => void,
  isCurrent: () => boolean = () => true,
): Promise<T> => {
  try {
    return await heartbeat;
  } catch (error) {
    if (activeCompanionSessionId && isCurrent()) stopLocalCompanion(error);
    throw error;
  }
};

type AuthoritativeHandoff = {
  session: RemoteSessionView;
  accept: (sessionId: string) => Promise<RemoteSessionView>;
  stopLocalCompanion: (session: RemoteSessionView) => Promise<void>;
  joinMedia: (session: RemoteSessionView) => Promise<void>;
};

/**
 * The accept transaction owns the AI-to-family media handoff. Local AI must
 * remain alive while the call is merely ringing and may stop only after the
 * server has returned an authoritative non-ringing state.
 */
export const acceptRemoteWithAuthoritativeHandoff = async ({
  session,
  accept,
  stopLocalCompanion,
  joinMedia,
}: AuthoritativeHandoff) => {
  const authoritative =
    session.status === "RINGING" ? await accept(session.id) : session;

  if (authoritative.status === "RINGING") {
    throw new Error("服务端尚未确认现场接听");
  }

  await stopLocalCompanion(authoritative);

  if (terminalStatuses.has(authoritative.status)) return authoritative;
  if (!joinableStatuses.has(authoritative.status)) {
    throw new Error(`无法从状态 ${authoritative.status} 加入远程通话`);
  }

  await joinMedia(authoritative);
  return authoritative;
};
