import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import request from 'supertest';
import { ulid } from 'ulid';
import { DeviceAccessTokenService } from '../src/modules/device-activation/device-access-token.service';
import {
  DEVICE_KEY_PROTECTION,
  INSTALLATION_KEY_ALGORITHM,
} from '../src/modules/device-activation/device-activation.constants';
import { createTodayCareHarness } from './support/today-care-harness';

const describeMySql = process.env.TODAY_CARE_MYSQL_TEST_URL
  ? describe
  : describe.skip;
describeMySql(
  'companion readiness: read-only authenticated MySQL checks',
  () => {
    let fixture: Awaited<ReturnType<typeof createTodayCareHarness>>;
    const deviceId = ulid();
    const bindingId = ulid();
    const credentialId = ulid();
    const credentialFamilyId = ulid();
    let token: string;
    const endpoint = '/openBMB/api/v1/device/readiness';

    beforeAll(async () => {
      fixture = await createTodayCareHarness();
      // Seed a test identity; this suite verifies device authentication, not installation attestation.
      const { publicKey } = generateKeyPairSync('ed25519');
      await fixture.db.device.create({
        data: {
          id: deviceId,
          platform: 'WEB',
          status: 'ACTIVE',
          installationKeyFingerprint: randomBytes(32),
          installationPublicKey: publicKey.export({
            format: 'der',
            type: 'spki',
          }),
          installationKeyAlgorithm: INSTALLATION_KEY_ALGORITHM.ed25519,
          keyProtection: DEVICE_KEY_PROTECTION.nonExportableV1,
        },
      });
      await fixture.db.companionBinding.create({
        data: {
          id: bindingId,
          deviceId,
          householdId: fixture.householdId,
          recipientId: fixture.emptyRecipientId,
          displayName: '仅本地启动检查',
          status: 'ACTIVE',
          activatedByMemberId: fixture.ownerMemberId,
          activatedAt: new Date(),
        },
      });
      await fixture.db.deviceCredential.create({
        data: {
          id: credentialId,
          bindingId,
          credentialFamilyId,
          credentialHash: randomBytes(32),
          deviceKeyThumbprint: randomBytes(32),
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      token = fixture.app.get(DeviceAccessTokenService).issue({
        deviceId,
        bindingId,
        credentialId,
        credentialFamilyId,
        householdId: fixture.householdId,
        recipientId: fixture.emptyRecipientId,
        bindingVersion: 1,
      }).accessToken;
    }, 30_000);

    afterAll(async () => {
      if (!fixture) return;
      try {
        await fixture.db.recipientConsentState.deleteMany({
          where: { recipientId: fixture.emptyRecipientId },
        });
        await fixture.db.deviceCredential.deleteMany({ where: { bindingId } });
        await fixture.db.companionBinding.deleteMany({
          where: { id: bindingId },
        });
        await fixture.db.device.deleteMany({ where: { id: deviceId } });
      } finally {
        await fixture.cleanup();
      }
    }, 30_000);

    const check = () =>
      request(fixture.app.getHttpServer())
        .get(endpoint)
        .auth(token, { type: 'bearer' });
    it('requires a device token, rather than a family user token', async () => {
      await request(fixture.app.getHttpServer()).get(endpoint).expect(401);
      await request(fixture.app.getHttpServer())
        .get(endpoint)
        .auth(fixture.owner.session.accessToken, { type: 'bearer' })
        .expect(401);
    });
    it('reads current consent and does not mark the device online or start a session', async () => {
      const initial = await check().expect(200);
      expect(initial.headers['cache-control']).toContain('no-store');
      expect(initial.body.data.authorization.audio.allowed).toBe(false);
      await fixture.db.recipientConsentState.createMany({
        data: ['MICROPHONE_CAPTURE', 'MODEL_PROCESSING'].map((scope) => ({
          id: ulid(),
          householdId: fixture.householdId,
          recipientId: fixture.emptyRecipientId,
          scope,
          decision: 'GRANTED',
        })),
      });
      const granted = (await check().expect(200)).body.data;
      expect(granted.authorization.audio.allowed).toBe(true);
      expect(granted.authorization.audioVideo.missingScopes).toEqual([
        'CAMERA_CAPTURE',
      ]);
      expect(granted.model.connectionStatus).toBe('NOT_TESTED');
      expect(Object.keys(granted).sort()).toEqual([
        'authorization',
        'bindingId',
        'checkedAt',
        'deviceId',
        'model',
        'schemaVersion',
      ]);
      await fixture.db.recipientConsentState.updateMany({
        where: {
          recipientId: fixture.emptyRecipientId,
          scope: 'MODEL_PROCESSING',
        },
        data: { decision: 'REVOKED' },
      });
      expect(
        (await check().expect(200)).body.data.authorization.audio.missingScopes,
      ).toEqual(['MODEL_PROCESSING']);
      expect(
        (await fixture.db.device.findUniqueOrThrow({ where: { id: deviceId } }))
          .lastSeenAt,
      ).toBeNull();
      expect(
        await fixture.db.companionSession.count({ where: { bindingId } }),
      ).toBe(0);
      expect(
        await fixture.db.modelSession.count({
          where: { companionSession: { bindingId } },
        }),
      ).toBe(0);
    });
    it('rejects a revoked binding even with a signed unexpired token', async () => {
      await fixture.db.companionBinding.update({
        where: { id: bindingId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await check().expect(401);
    });
  },
);
