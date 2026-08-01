import { describe, expect, it, jest } from '@jest/globals';

import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CareWorkflowContentCipher } from '../care-workflow/ports/content-cipher.port';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import type { MediaLeasePort } from '../realtime-communication/ports/media-lease.port';
import { CompanionSessionApplicationService } from './companion-session.application.service';

jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const principal = {
  kind: 'DEVICE' as const,
  tokenId: '01J00000000000000000000001',
  credentialId: '01J00000000000000000000002',
  credentialFamilyId: '01J00000000000000000000003',
  deviceId: '01J00000000000000000000004',
  bindingId: '01J00000000000000000000005',
  householdId: '01J00000000000000000000006',
  recipientId: '01J00000000000000000000007',
  bindingVersion: 1,
  capabilities: ['COMPANION' as const],
};

const binding = {
  id: principal.bindingId,
  bindingVersion: 1,
  householdId: principal.householdId,
  recipientId: principal.recipientId,
  status: 'ACTIVE',
  device: { id: principal.deviceId, status: 'ACTIVE' },
  recipient: {
    id: principal.recipientId,
    status: 'ACTIVE',
    preferredName: '王奶奶',
    timezone: 'Asia/Shanghai',
  },
};

function codeOf(error: unknown): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('getResponse' in error) ||
    typeof error.getResponse !== 'function'
  ) {
    return undefined;
  }
  return (error.getResponse() as { code?: string }).code;
}

function serviceWith(options: {
  consent: string[];
  modelSession?: Record<string, unknown>;
}) {
  const prisma = {
    companionBinding: { findFirst: jest.fn(async () => binding) },
    recipientConsentState: {
      findMany: jest.fn(async () =>
        options.consent.map((scope) => ({ scope, decision: 'GRANTED' })),
      ),
    },
    modelSession: {
      findFirst: jest.fn(async () => options.modelSession ?? null),
    },
  };
  const config = { get: jest.fn(() => undefined) };
  const encryption = {
    sealFields: jest.fn(),
    openFields: jest.fn(),
  };
  const leases = {
    acquire: jest.fn(() => Promise.resolve(true)),
    renew: jest.fn(() => Promise.resolve(true)),
    transfer: jest.fn(() => Promise.resolve(true)),
    release: jest.fn(() => Promise.resolve()),
    current: jest.fn(() => Promise.resolve(null)),
  };
  const careCipher = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  };
  return new CompanionSessionApplicationService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    encryption as unknown as DataEncryptionPort,
    leases as unknown as MediaLeasePort,
    careCipher as unknown as CareWorkflowContentCipher,
  );
}

describe('CompanionSessionApplicationService consent boundary', () => {
  it('requires separate camera consent for an audio-video session', async () => {
    const service = serviceWith({
      consent: ['MICROPHONE_CAPTURE', 'MODEL_PROCESSING'],
    });
    try {
      await service.startCompanionSession({
        principal,
        mode: 'AUDIO_VIDEO',
        idempotencyKey: 'session-0001',
        traceId: 'request-1',
      });
      throw new Error('expected consent rejection');
    } catch (error) {
      expect(codeOf(error)).toBe('CONSENT_REQUIRED');
      expect(error).toMatchObject({ scope: 'CAMERA_CAPTURE' });
    }
  });

  it('rejects a user transcript unless independent ASR consent is current', async () => {
    const service = serviceWith({
      consent: ['MICROPHONE_CAPTURE', 'MODEL_PROCESSING'],
      modelSession: {
        id: '01J00000000000000000000008',
        status: 'ACTIVE',
        companionSession: {
          id: '01J00000000000000000000009',
          status: 'ACTIVE',
          householdId: principal.householdId,
          recipientId: principal.recipientId,
        },
      },
    });
    try {
      await service.appendUtterance({
        principal,
        modelSessionId: '01J00000000000000000000008',
        sequenceNo: 1,
        speaker: 'USER',
        source: 'ASR',
        providerEventId: 'asr-event-1',
        rawText: '今天阳光很好',
        isFinal: true,
      });
      throw new Error('expected consent rejection');
    } catch (error) {
      expect(codeOf(error)).toBe('CONSENT_REQUIRED');
      expect(error).toMatchObject({ scope: 'MODEL_INPUT_TRANSCRIPTION' });
    }
  });

  it('rejects attempts to label model output as independent ASR', async () => {
    const service = serviceWith({ consent: [] });
    await expect(
      service.appendUtterance({
        principal,
        modelSessionId: '01J00000000000000000000008',
        sequenceNo: 1,
        speaker: 'ASSISTANT',
        source: 'ASR',
        providerEventId: 'forged-source',
        rawText: '伪造内容',
        isFinal: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'UTTERANCE_SOURCE_INVALID' },
    });
  });
});
