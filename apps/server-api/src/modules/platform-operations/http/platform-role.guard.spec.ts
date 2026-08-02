import { describe, expect, it, jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AdminAccessGuard } from '../../identity/http/admin-access.guard';
import { InvalidAccessTokenException } from '../../identity/identity.errors';
import { PlatformAccessDeniedException } from '../platform-operations.errors';
import type { PlatformRoleAuthorizer } from '../platform-role.authorizer';
import { PlatformRoleGuard } from './platform-role.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('PlatformRoleGuard', () => {
  it('authenticates only the admin audience and resolves current roles on every request', async () => {
    const request: Record<string, unknown> = {};
    const adminGuard = {
      canActivate: jest.fn(async () => {
        request.adminPrincipal = {
          kind: 'ADMIN',
          userId: 'user-auditor',
          sessionId: 'admin-session-1',
          tokenId: 'admin-token-1',
          status: 'ACTIVE',
        };
        return true;
      }),
    };
    const requireAny = jest.fn(async () => ['CONTENT_AUDITOR'] as const);
    const reflector = {
      getAllAndOverride: jest.fn(() => ['CONTENT_AUDITOR']),
    };
    const guard = new PlatformRoleGuard(
      adminGuard as unknown as AdminAccessGuard,
      { requireAny } as unknown as PlatformRoleAuthorizer,
      reflector as unknown as Reflector,
    );

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(adminGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(requireAny).toHaveBeenCalledTimes(2);
    expect(requireAny).toHaveBeenLastCalledWith('user-auditor', [
      'CONTENT_AUDITOR',
    ]);
    expect(request.platformRoles).toEqual(['CONTENT_AUDITOR']);
  });

  it('rejects an existing admin token immediately after its role is revoked', async () => {
    const request = {
      adminPrincipal: {
        kind: 'ADMIN',
        userId: 'former-admin',
        sessionId: 'admin-session-1',
        tokenId: 'admin-token-1',
        status: 'ACTIVE',
      },
    };
    const requireAny = jest.fn(async () => {
      throw new PlatformAccessDeniedException();
    });
    const guard = new PlatformRoleGuard(
      { canActivate: jest.fn() } as unknown as AdminAccessGuard,
      { requireAny } as unknown as PlatformRoleAuthorizer,
      {
        getAllAndOverride: jest.fn(() => ['ADMIN']),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      PlatformAccessDeniedException,
    );
    expect(requireAny).toHaveBeenCalledWith('former-admin', ['ADMIN']);
  });

  it('cannot fall back to ordinary user-token authentication', async () => {
    const adminGuard = {
      canActivate: jest.fn(async () => {
        throw new InvalidAccessTokenException();
      }),
    };
    const requireAny = jest.fn();
    const guard = new PlatformRoleGuard(
      adminGuard as unknown as AdminAccessGuard,
      { requireAny } as unknown as PlatformRoleAuthorizer,
      {
        getAllAndOverride: jest.fn(() => ['ADMIN']),
      } as unknown as Reflector,
    );

    await expect(guard.canActivate(contextFor({}))).rejects.toBeInstanceOf(
      InvalidAccessTokenException,
    );
    expect(requireAny).not.toHaveBeenCalled();
  });
});
