import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlatformAccessDeniedException } from './platform-operations.errors';
import { PlatformRoleAuthorizer } from './platform-role.authorizer';

describe('PlatformRoleAuthorizer', () => {
  it('loads current platform assignments for each authorization decision', async () => {
    const findMany = jest.fn(async () => [{ role: { code: 'ADMIN' } }]);
    const authorizer = new PlatformRoleAuthorizer({
      platformRoleAssignment: { findMany },
    } as unknown as PrismaService);

    await expect(
      authorizer.requireAny('operator-1', ['ADMIN']),
    ).resolves.toEqual(['ADMIN']);
    await expect(
      authorizer.requireAny('operator-1', ['ADMIN']),
    ).resolves.toEqual(['ADMIN']);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenLastCalledWith({
      where: {
        userId: 'operator-1',
        role: {
          scope: 'PLATFORM',
          code: { in: ['ADMIN', 'CONTENT_AUDITOR'] },
        },
      },
      select: { role: { select: { code: true } } },
    });
  });

  it('denies access after all matching assignments are removed', async () => {
    const authorizer = new PlatformRoleAuthorizer({
      platformRoleAssignment: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService);

    await expect(authorizer.requireAny('former-admin')).rejects.toBeInstanceOf(
      PlatformAccessDeniedException,
    );
  });
});
