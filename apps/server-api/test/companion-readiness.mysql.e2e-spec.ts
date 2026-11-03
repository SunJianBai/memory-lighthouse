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
    const companionIds: string[] = [];
    const receiptKeys: string[] = [];
    const routineIds: string[] = [];
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
        await fixture.db.careCommandReceipt.deleteMany({
          where: { idempotencyKey: { in: receiptKeys } },
        });
        await fixture.db.outboxEvent.deleteMany({
          where: { aggregateId: { in: companionIds } },
        });
        await fixture.db.companionSession.deleteMany({ where: { bindingId } });
        await fixture.db.routineOccurrence.deleteMany({
          where: { routineId: { in: routineIds } },
        });
        await fixture.db.routineSchedule.deleteMany({
          where: { routineId: { in: routineIds } },
        });
        await fixture.db.outboxEvent.deleteMany({
          where: { aggregateType: 'ROUTINE', aggregateId: { in: routineIds } },
        });
        await fixture.db.routine.deleteMany({
          where: { id: { in: routineIds } },
        });
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
    it('stops an existing authenticated device session after a real pause command', async () => {
      await fixture.db.recipientConsentState.updateMany({
        where: { recipientId: fixture.emptyRecipientId },
        data: { decision: 'GRANTED' },
      });
      const http = fixture.app.getHttpServer();
      const collection = `/openBMB/api/v1/households/${fixture.householdId}/care-recipients/${fixture.emptyRecipientId}/routines`;
      const routine = (
        await request(http)
          .post(collection)
          .auth(fixture.owner.session.accessToken, { type: 'bearer' })
          .send({
            type: 'OTHER',
            title: '暂停会话同步验证',
            instructions: '仅隔离测试',
            confirmationQuestion: '完成了吗？',
            schedule: {
              timezone: 'Asia/Shanghai',
              localTimeMinutes: 540,
              weekdayMask: 127,
              startDate: '2026-09-20',
              graceMinutes: 5,
              familyNoticeMinutes: 15,
            },
          })
          .expect(201)
      ).body.data;
      routineIds.push(routine.id);
      const started = (
        await request(http)
          .post('/openBMB/api/v1/device/companion-sessions')
          .auth(token, { type: 'bearer' })
          .set('Idempotency-Key', `start-${ulid()}`)
          .send({ mode: 'AUDIO' })
          .expect(201)
      ).body.data.session;
      companionIds.push(started.id);
      const heartbeat = () =>
        request(http)
          .post('/openBMB/api/v1/device/heartbeats')
          .auth(token, { type: 'bearer' })
          .send({ activeCompanionSessionId: started.id });
      expect((await heartbeat().expect(201)).body.data.mediaDirective).toBe(
        'CONTINUE',
      );
      const key = `pause-${ulid()}`;
      receiptKeys.push(key);
      await request(http)
        .post(
          `/openBMB/api/v1/households/${fixture.householdId}/routines/${routine.id}/pause`,
        )
        .auth(fixture.owner.session.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send({ version: routine.version })
        .expect(200);
      expect((await heartbeat().expect(201)).body.data).toMatchObject({
        mediaDirective: 'STOP',
        reason: 'ROUTINES_CHANGED',
      });
      expect(
        await fixture.db.companionSession.findUnique({
          where: { id: started.id },
        }),
      ).toMatchObject({ status: 'ENDED', endReason: 'ROUTINES_CHANGED' });
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
