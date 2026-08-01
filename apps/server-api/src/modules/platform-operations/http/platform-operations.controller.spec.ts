import { describe, expect, it, jest } from '@jest/globals';

import type { IdentityApplicationService } from '../../identity/identity.application.service';
import type { PlatformOperationsApplicationService } from '../platform-operations.application.service';
import type { PlatformPrincipal } from '../platform-operations.types';
import { PlatformOperationsController } from './platform-operations.controller';

describe('PlatformOperationsController identity', () => {
  it('returns the authenticated user with current database-backed roles and capabilities', async () => {
    const principal: PlatformPrincipal = {
      kind: 'ADMIN',
      userId: 'admin-user',
      sessionId: 'session-1',
      tokenId: 'token-1',
      status: 'ACTIVE',
      platformRoles: ['ADMIN'],
    };
    const user = {
      id: principal.userId,
      displayName: 'Admin',
      status: 'ACTIVE',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      identities: [],
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    const getMe = jest.fn(async () => user);
    const controller = new PlatformOperationsController(
      {} as PlatformOperationsApplicationService,
      { getMe } as unknown as IdentityApplicationService,
    );

    await expect(controller.getIdentity(principal)).resolves.toEqual({
      user,
      platformRoles: ['ADMIN'],
      capabilities: expect.arrayContaining([
        'PLATFORM_DASHBOARD_READ',
        'PLATFORM_AUDIT_LOGS_READ',
      ]),
    });
    expect(getMe).toHaveBeenCalledWith(principal);
  });
});
