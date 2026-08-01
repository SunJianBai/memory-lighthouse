import { describe, expect, it } from '@jest/globals';

import { DeviceAccessTokenService } from './device-access-token.service';
import type { DeviceActivationSecurityConfig } from './device-activation.config';
import type { ClockPort } from './device-activation.types';

class FixedClock implements ClockPort {
  constructor(public nowValue = new Date('2026-08-01T10:00:00.000Z')) {}
  now(): Date {
    return new Date(this.nowValue);
  }
}

const config: DeviceActivationSecurityConfig = {
  activationPepper: Buffer.alloc(32, 1),
  credentialPepper: Buffer.alloc(32, 2),
  accessTokenSecret: Buffer.alloc(32, 3),
  accessTokenTtlSeconds: 600,
  environment: 'test',
  challengeTtlSeconds: 300,
  challengeMaxAttempts: 5,
  credentialTtlSeconds: 2_592_000,
};

const principal = {
  credentialId: '01J00000000000000000000001',
  credentialFamilyId: '01J00000000000000000000002',
  deviceId: '01J00000000000000000000003',
  bindingId: '01J00000000000000000000004',
  householdId: '01J00000000000000000000005',
  recipientId: '01J00000000000000000000006',
  bindingVersion: 1,
};

describe('DeviceAccessTokenService', () => {
  it('issues a scoped ten-minute token and verifies its environment', () => {
    const clock = new FixedClock();
    const service = new DeviceAccessTokenService(config, clock);
    const issued = service.issue(principal);

    expect(issued.accessTokenExpiresInSeconds).toBe(600);
    expect(service.verify(issued.accessToken)).toMatchObject({
      kind: 'DEVICE',
      ...principal,
      capabilities: ['COMPANION', 'REMOTE_ASSISTANCE'],
    });

    const otherEnvironment = new DeviceAccessTokenService(
      { ...config, environment: 'production' },
      clock,
    );
    expect(otherEnvironment.verify(issued.accessToken)).toBeNull();
  });

  it('rejects tampering and expiration', () => {
    const clock = new FixedClock();
    const service = new DeviceAccessTokenService(config, clock);
    const issued = service.issue(principal);
    const parts = issued.accessToken.split('.');
    const tampered = `${parts[0]}.${parts[1]}x.${parts[2]}`;
    expect(service.verify(tampered)).toBeNull();

    clock.nowValue = new Date('2026-08-01T10:10:00.000Z');
    expect(service.verify(issued.accessToken)).toBeNull();
  });
});
