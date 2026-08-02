import { describe, expect, it, jest } from '@jest/globals';

import type { RequestWithContext } from '../../../common/http/request-context';
import type { PlatformAuditIpHasher } from '../platform-audit-ip-hasher';
import type { PlatformOperationsApplicationService } from '../platform-operations.application.service';
import type { PlatformPrincipal } from '../platform-operations.types';
import { DevelopmentContentInspectionController } from './development-content-inspection.controller';

describe('DevelopmentContentInspectionController audit metadata', () => {
  it('hashes the controller-observed client IP and never forwards the raw address', async () => {
    const sourceIpHash = Uint8Array.from(
      Array.from({ length: 32 }, (_, index) => 255 - index),
    );
    const inspectMemoryRevision = jest.fn(async (command: unknown) => command);
    const hash = jest.fn(() => sourceIpHash);
    const controller = new DevelopmentContentInspectionController(
      {
        inspectMemoryRevision,
      } as unknown as PlatformOperationsApplicationService,
      { hash } as unknown as PlatformAuditIpHasher,
    );
    const principal: PlatformPrincipal = {
      kind: 'ADMIN',
      userId: '01K1K000000000000000000001',
      sessionId: '01K1K000000000000000000002',
      tokenId: '01K1K000000000000000000003',
      status: 'ACTIVE',
      platformRoles: ['CONTENT_AUDITOR'],
    };
    const rawIpAddress = '203.0.113.24';
    const request = {
      requestId: 'request-controller-ip',
      ip: rawIpAddress,
      headers: { 'user-agent': 'inspection-test-agent' },
    } as RequestWithContext;

    await controller.inspectCurrentMemoryRevision(
      principal,
      '01K1K000000000000000000004',
      { grantId: '01K1K000000000000000000005' },
      request,
    );

    expect(hash).toHaveBeenCalledWith(rawIpAddress);
    const command = inspectMemoryRevision.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      request: {
        requestId: request.requestId,
        sourceIpHash,
        userAgent: 'inspection-test-agent',
      },
    });
    expect(JSON.stringify(command)).not.toContain(rawIpAddress);
  });
});
