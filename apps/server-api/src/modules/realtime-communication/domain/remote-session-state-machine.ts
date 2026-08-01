import {
  REMOTE_SESSION_STATUS,
  TERMINAL_REMOTE_STATUSES,
} from '../realtime.constants';
import {
  RemoteSessionStateException,
  RemoteSessionTerminalException,
} from '../realtime.errors';

const transitions: Readonly<Record<string, readonly string[]>> = {
  [REMOTE_SESSION_STATUS.ringing]: [
    REMOTE_SESSION_STATUS.accepted,
    REMOTE_SESSION_STATUS.declined,
    REMOTE_SESSION_STATUS.cancelled,
    REMOTE_SESSION_STATUS.expired,
    REMOTE_SESSION_STATUS.revoked,
    REMOTE_SESSION_STATUS.failed,
  ],
  [REMOTE_SESSION_STATUS.accepted]: [
    REMOTE_SESSION_STATUS.connecting,
    REMOTE_SESSION_STATUS.cancelled,
    REMOTE_SESSION_STATUS.ending,
    REMOTE_SESSION_STATUS.revoked,
    REMOTE_SESSION_STATUS.failed,
  ],
  [REMOTE_SESSION_STATUS.connecting]: [
    REMOTE_SESSION_STATUS.active,
    REMOTE_SESSION_STATUS.cancelled,
    REMOTE_SESSION_STATUS.ending,
    REMOTE_SESSION_STATUS.revoked,
    REMOTE_SESSION_STATUS.failed,
  ],
  [REMOTE_SESSION_STATUS.active]: [
    REMOTE_SESSION_STATUS.ending,
    REMOTE_SESSION_STATUS.ended,
    REMOTE_SESSION_STATUS.revoked,
    REMOTE_SESSION_STATUS.failed,
  ],
  [REMOTE_SESSION_STATUS.ending]: [
    REMOTE_SESSION_STATUS.ended,
    REMOTE_SESSION_STATUS.failed,
  ],
};

export function assertRemoteTransition(from: string, to: string): void {
  if ((TERMINAL_REMOTE_STATUSES as readonly string[]).includes(from)) {
    throw new RemoteSessionTerminalException();
  }
  if (!(transitions[from] ?? []).includes(to)) {
    throw new RemoteSessionStateException(transitions[from] ?? []);
  }
}

export function isRemoteTerminal(status: string): boolean {
  return (TERMINAL_REMOTE_STATUSES as readonly string[]).includes(status);
}
