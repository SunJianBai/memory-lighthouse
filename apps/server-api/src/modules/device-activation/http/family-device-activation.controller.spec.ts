import { describe, expect, it, jest } from '@jest/globals';
import { validate } from 'class-validator';

import { RATE_LIMIT_POLICY_METADATA } from '../../../infrastructure/rate-limit/rate-limit.constants';
import { RateLimitPolicy } from '../../../infrastructure/rate-limit';
import type { UserPrincipal } from '../../identity';
import type { DeviceActivationApplicationService } from '../device-activation.application.service';
import {
  RevokeCompanionBindingDto,
  UpdateCompanionBindingDto,
} from './device-activation.dto';
import { FamilyDeviceActivationController } from './family-device-activation.controller';

const principal: UserPrincipal = {
  kind: 'USER',
  userId: 'user-1',
  sessionId: 'session-1',
  tokenId: 'token-1',
  status: 'ACTIVE',
};

function policyFor(
  controller: object,
  methodName: string,
): RateLimitPolicy | undefined {
  const handler = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(controller),
    methodName,
  )?.value as object | undefined;
  return handler
    ? Reflect.getMetadata(RATE_LIMIT_POLICY_METADATA, handler)
    : undefined;
}

describe('FamilyDeviceActivationController sensitive-write contracts', () => {
  it('forwards currentPassword and rate limits binding state changes and revocation', async () => {
    const service = {
      updateCompanionBinding: jest.fn(async () => ({ id: 'binding-1' })),
      revokeCompanionBinding: jest.fn(async () => ({ revoked: true as const })),
    };
    const controller = new FamilyDeviceActivationController(
      service as unknown as DeviceActivationApplicationService,
    );

    await controller.updateBinding(principal, 'household-1', 'binding-1', {
      currentPassword: 'current-password',
      version: 4,
      status: 'SUSPENDED',
    });
    await controller.revokeBinding(principal, 'household-1', 'binding-1', {
      currentPassword: 'current-password',
      reasonCode: 'FAMILY_REQUEST',
    });

    expect(service.updateCompanionBinding).toHaveBeenCalledWith({
      userId: principal.userId,
      householdId: 'household-1',
      bindingId: 'binding-1',
      currentPassword: 'current-password',
      version: 4,
      status: 'SUSPENDED',
    });
    expect(service.revokeCompanionBinding).toHaveBeenCalledWith({
      userId: principal.userId,
      householdId: 'household-1',
      bindingId: 'binding-1',
      currentPassword: 'current-password',
      reasonCode: 'FAMILY_REQUEST',
    });
    expect(policyFor(controller, 'updateBinding')).toBe(
      RateLimitPolicy.SENSITIVE_WRITE_REAUTHENTICATION,
    );
    expect(policyFor(controller, 'revokeBinding')).toBe(
      RateLimitPolicy.SENSITIVE_WRITE_REAUTHENTICATION,
    );
  });

  it.each([
    Object.assign(new UpdateCompanionBindingDto(), {
      version: 0,
      status: 'SUSPENDED',
    }),
    Object.assign(new RevokeCompanionBindingDto(), {}),
  ])('rejects a missing currentPassword in %s', async (dto) => {
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('currentPassword');
  });
});
