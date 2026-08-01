import { describe, expect, it, jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { UserAccessGuard } from '../../identity/http/user-access.guard';
import { PlatformAccessDeniedException } from '../platform-operations.errors';
import { PlatformRoleGuard } from './platform-role.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('PlatformRoleGuard', () => {
  it('reuses user authentication and resolves platform roles from MySQL on every request', async () => {
    const request: Record<string, unknown> = {};
    const userGuard = {
      canActivate: jest.fn(async () => {
        request.userPrincipal = {
          kind: 'USER',
          userId: 'user-auditor',
          sessionId: 'session-1',
          tokenId: 'token-1',
          status: 'ACTIVE',
        };
        return true;
      }),
    };
    const findMany = jest.fn(async () => [
      { role: { code: 'CONTENT_AUDITOR' } },
    ]);
    const prisma = { platformRoleAssignment: { findMany } };
    const reflector = {
      getAllAndOverride: jest.fn(() => ['CONTENT_AUDITOR']),
    };
    const guard = new PlatformRoleGuard(
      userGuard as unknown as UserAccessGuard,
      prisma as unknown as PrismaService,
      reflector as unknown as Reflector,
    );

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(userGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-auditor' }),
      }),
    );
    expect(request.platformRoles).toEqual(['CONTENT_AUDITOR']);
  });

  it('does not trust authentication alone when the current assignment is missing', async () => {
    const request = {
      userPrincipal: {
        kind: 'USER',
        userId: 'former-admin',
        sessionId: 'session-1',
        tokenId: 'token-1',
        status: 'ACTIVE',
      },
    };
    const guard = new PlatformRoleGuard(
      { canActivate: jest.fn() } as unknown as UserAccessGuard,
      {
        platformRoleAssignment: { findMany: jest.fn(async () => []) },
      } as unknown as PrismaService,
      {
        getAllAndOverride: jest.fn(() => ['ADMIN']),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      PlatformAccessDeniedException,
    );
  });
});
