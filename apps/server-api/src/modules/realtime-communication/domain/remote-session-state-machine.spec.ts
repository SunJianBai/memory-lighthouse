import { describe, expect, it } from '@jest/globals';

import {
  assertRemoteTransition,
  isRemoteTerminal,
} from './remote-session-state-machine';

describe('remote assistance state machine', () => {
  it('allows onsite accept but never revives a terminal session', () => {
    expect(() => assertRemoteTransition('RINGING', 'ACCEPTED')).not.toThrow();
    expect(() => assertRemoteTransition('DECLINED', 'ACTIVE')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'REMOTE_SESSION_TERMINAL' }),
      }),
    );
    expect(isRemoteTerminal('ENDED')).toBe(true);
  });

  it('does not let a family button mark media active', () => {
    expect(() => assertRemoteTransition('ACCEPTED', 'ACTIVE')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'REMOTE_SESSION_STATE_CONFLICT',
        }),
      }),
    );
  });

  it('allows timeout and lease-loss terminalization before media becomes active', () => {
    expect(() => assertRemoteTransition('RINGING', 'EXPIRED')).not.toThrow();
    expect(() => assertRemoteTransition('RINGING', 'FAILED')).not.toThrow();
    expect(() =>
      assertRemoteTransition('CONNECTING', 'CANCELLED'),
    ).not.toThrow();
    expect(() => assertRemoteTransition('CONNECTING', 'FAILED')).not.toThrow();
  });
});
