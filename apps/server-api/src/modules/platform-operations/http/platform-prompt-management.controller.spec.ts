import { describe, expect, it, jest } from '@jest/globals';

import type { RequestWithContext } from '../../../common/http/request-context';
import type { PlatformAuditIpHasher } from '../platform-audit-ip-hasher';
import type { PlatformPromptManagementApplicationService } from '../platform-prompt-management.application.service';
import type { PlatformPrincipal } from '../platform-operations.types';
import { PlatformPromptManagementController } from './platform-prompt-management.controller';

describe('PlatformPromptManagementController', () => {
  it('passes the optimistic-lock id and privacy-safe request metadata to publication', async () => {
    const sourceIpHash = Uint8Array.from(Array(32).fill(7));
    const publishCompanionPrompt = jest.fn(async (command) => command);
    const controller = new PlatformPromptManagementController(
      {
        publishCompanionPrompt,
      } as unknown as PlatformPromptManagementApplicationService,
      {
        hash: jest.fn(() => sourceIpHash),
      } as unknown as PlatformAuditIpHasher,
    );
    const principal = {
      kind: 'ADMIN',
      userId: 'admin-user',
      sessionId: 'admin-session',
      tokenId: 'admin-token',
      status: 'ACTIVE',
      platformRoles: ['ADMIN'],
    } as PlatformPrincipal;
    const request = {
      requestId: 'request-42',
      ip: '203.0.113.8',
      headers: { 'user-agent': 'controller-test' },
    } as unknown as RequestWithContext;

    await controller.publishRevision(
      principal,
      {
        expectedCurrentPromptId: '01K1P000000000000000000001',
        content: '新的提示词',
        reason: '减少重复回复',
      },
      request,
    );

    expect(publishCompanionPrompt).toHaveBeenCalledWith({
      principal,
      expectedCurrentPromptId: '01K1P000000000000000000001',
      content: '新的提示词',
      reason: '减少重复回复',
      request: {
        requestId: 'request-42',
        sourceIpHash,
        userAgent: 'controller-test',
      },
    });
  });
});
