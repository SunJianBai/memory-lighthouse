import { describe, expect, it, jest } from '@jest/globals';
import { validate } from 'class-validator';

import { RATE_LIMIT_POLICY_METADATA } from '../../../infrastructure/rate-limit/rate-limit.constants';
import { RateLimitPolicy } from '../../../infrastructure/rate-limit';
import type { HouseholdApplicationService } from '../household.application.service';
import type { AuthPrincipal } from '../household.types';
import { CareRecipientsController } from './care-recipients.controller';
import {
  HouseholdRoleCodeDto,
  PutCareAuthorityDto,
  RemoveHouseholdMemberDto,
  UpdateHouseholdMemberDto,
} from './household.dto';
import { HouseholdsController } from './households.controller';

const principal: AuthPrincipal = {
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

describe('household sensitive-write controller contracts', () => {
  it('forwards currentPassword for role updates and member removal', async () => {
    const service = {
      updateMember: jest.fn(async () => ({ id: 'member-1' })),
      removeMember: jest.fn(async () => undefined),
    };
    const controller = new HouseholdsController(
      service as unknown as HouseholdApplicationService,
    );

    await controller.updateMember(principal, 'household-1', 'member-1', {
      roleCodes: [HouseholdRoleCodeDto.CAREGIVER],
      version: 2,
      currentPassword: 'current-password',
    });
    await controller.removeMember(
      principal,
      'household-1',
      'member-1',
      { version: 2 },
      { currentPassword: 'current-password' },
    );

    expect(service.updateMember).toHaveBeenCalledWith(
      principal,
      'household-1',
      'member-1',
      {
        roleCodes: [HouseholdRoleCodeDto.CAREGIVER],
        version: 2,
        currentPassword: 'current-password',
      },
    );
    expect(service.removeMember).toHaveBeenCalledWith(
      principal,
      'household-1',
      'member-1',
      { version: 2, currentPassword: 'current-password' },
    );
    expect(policyFor(controller, 'updateMember')).toBe(
      RateLimitPolicy.SENSITIVE_WRITE_REAUTHENTICATION,
    );
    expect(policyFor(controller, 'removeMember')).toBe(
      RateLimitPolicy.SENSITIVE_WRITE_REAUTHENTICATION,
    );
  });

  it('forwards currentPassword for Care Authority writes and rate limits them', async () => {
    const service = {
      putCareAuthority: jest.fn(async () => ({ id: 'authority-1' })),
    };
    const controller = new CareRecipientsController(
      service as unknown as HouseholdApplicationService,
    );
    const body = {
      currentPassword: 'current-password',
      accessLevel: 'FULL',
      canManageProfile: true,
      canManageConsent: true,
      canManageRoutine: true,
      canViewEvents: true,
      canViewConversation: true,
      canActivateDevice: true,
      canRemoteCall: true,
      receiveNotifications: true,
      status: 'ACTIVE' as const,
    };

    await controller.putAuthority(
      principal,
      'household-1',
      'recipient-1',
      'member-1',
      body,
    );

    expect(service.putCareAuthority).toHaveBeenCalledWith(
      principal,
      'household-1',
      'recipient-1',
      'member-1',
      body,
    );
    expect(policyFor(controller, 'putAuthority')).toBe(
      RateLimitPolicy.SENSITIVE_WRITE_REAUTHENTICATION,
    );
  });

  it.each([
    Object.assign(new UpdateHouseholdMemberDto(), {
      roleCodes: [HouseholdRoleCodeDto.CAREGIVER],
      version: 0,
    }),
    Object.assign(new RemoveHouseholdMemberDto(), {}),
    Object.assign(new PutCareAuthorityDto(), {
      accessLevel: 'FULL',
      canManageProfile: true,
      canManageConsent: true,
      canManageRoutine: true,
      canViewEvents: true,
      canViewConversation: true,
      canActivateDevice: true,
      canRemoteCall: true,
      receiveNotifications: true,
      status: 'ACTIVE',
    }),
  ])('rejects a missing currentPassword in %s', async (dto) => {
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('currentPassword');
  });
});
