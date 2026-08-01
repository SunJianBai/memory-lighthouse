import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';

import type { UserPrincipal } from '../../identity';
import type { NotificationApplicationService } from '../notification.application.service';
import { NotificationController } from './notification.controller';

const principal: UserPrincipal = {
  kind: 'USER',
  userId: '01K1M000000000000000000003',
  sessionId: '01K1M000000000000000000004',
  tokenId: '01K1M000000000000000000005',
  status: 'ACTIVE',
};

function handlerMetadata(
  methodName: 'listAdminAccesses' | 'markAdminAccessRead',
  metadataKey: string,
): unknown {
  const handler = Object.getOwnPropertyDescriptor(
    NotificationController.prototype,
    methodName,
  )?.value as unknown;
  return Reflect.getMetadata(metadataKey, handler as object);
}

describe('NotificationController', () => {
  it('binds the fixed household privacy routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, NotificationController)).toBe(
      'households/:householdId/privacy/admin-accesses',
    );
    expect(handlerMetadata('listAdminAccesses', METHOD_METADATA)).toBe(
      RequestMethod.GET,
    );
    expect(handlerMetadata('markAdminAccessRead', PATH_METADATA)).toBe(
      ':inspectionId/read',
    );
    expect(handlerMetadata('markAdminAccessRead', METHOD_METADATA)).toBe(
      RequestMethod.POST,
    );
  });

  it('uses the authenticated user for feed and idempotent read commands', async () => {
    const feed = { items: [], nextCursor: null, unreadCount: 0 };
    const read = {
      inspectionId: '01K1M000000000000000000011',
      readAt: '2026-08-02T10:05:00.000Z',
    };
    const service = {
      listAdminAccesses: jest.fn(async () => feed),
      markAdminAccessRead: jest.fn(async () => read),
    };
    const controller = new NotificationController(
      service as unknown as NotificationApplicationService,
    );

    await expect(
      controller.listAdminAccesses(principal, 'household-1', {
        cursor: '01K1M000000000000000000012',
        limit: 20,
      }),
    ).resolves.toBe(feed);
    await expect(
      controller.markAdminAccessRead(
        principal,
        'household-1',
        read.inspectionId,
      ),
    ).resolves.toBe(read);
    expect(service.listAdminAccesses).toHaveBeenCalledWith({
      userId: principal.userId,
      householdId: 'household-1',
      cursor: '01K1M000000000000000000012',
      limit: 20,
    });
    expect(service.markAdminAccessRead).toHaveBeenCalledWith({
      userId: principal.userId,
      householdId: 'household-1',
      inspectionId: read.inspectionId,
    });
  });
});
