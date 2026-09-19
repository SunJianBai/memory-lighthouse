import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ulid } from 'ulid';
import { AppModule } from '../../src/app.module';
import { configureHttpApplication } from '../../src/bootstrap/configure-http-application';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import {
  CARE_WORKFLOW_CLOCK,
  CARE_WORKFLOW_CONTENT_CIPHER,
} from '../../src/modules/care-workflow/care-workflow.constants';
import type { CareWorkflowContentCipher } from '../../src/modules/care-workflow/ports/content-cipher.port';
import { IdentityApplicationService } from '../../src/modules/identity/identity.application.service';
import { RedisMediaLeaseAdapter } from '../../src/modules/realtime-communication/adapters/redis-media-lease.adapter';
import { MEDIA_LEASE_PORT } from '../../src/modules/realtime-communication/realtime.constants';

export const CARE_TEST_NOW = new Date('2026-09-20T04:00:00.000Z');
export const CARE_TEST_PASSWORD = 'Local-Care-Fixture-2026!';

/** Requires an explicitly named isolated DB. Never accepts the normal runtime DB URL. */
export async function createTodayCareHarness() {
  const raw = process.env.TODAY_CARE_MYSQL_TEST_URL;
  if (!raw || process.env.NODE_ENV !== 'test')
    throw new Error(
      'Explicit test environment and TODAY_CARE_MYSQL_TEST_URL required',
    );
  const url = new URL(raw);
  if (
    url.protocol !== 'mysql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '13306' ||
    url.pathname !== '/lighthouse_iteration_test'
  ) {
    throw new Error('Only the isolated loopback iteration database is allowed');
  }
  process.env.DATABASE_URL = raw;
  // Remote media is outside this suite. Auth, authorization, queries and MySQL are real.
  const mediaLease = {
    acquire: async () => true,
    renew: async () => true,
    transfer: async () => true,
    release: async () => undefined,
    current: async () => null,
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedisMediaLeaseAdapter)
    .useValue(mediaLease)
    .overrideProvider(MEDIA_LEASE_PORT)
    .useValue(mediaLease)
    .overrideProvider(CARE_WORKFLOW_CLOCK)
    .useValue({ now: () => CARE_TEST_NOW })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttpApplication(app, module.get(ConfigService));
  await app.init();
  try {
    const db = app.get(PrismaService);
    const identity = app.get(IdentityApplicationService);
    const cipher = app.get<CareWorkflowContentCipher>(
      CARE_WORKFLOW_CONTENT_CIPHER,
    );
    const run = ulid();
    const account = async (kind: string) => {
      const username = `${kind}_${run.slice(-12)}`;
      const session = await identity.registerUser({
        username,
        password: CARE_TEST_PASSWORD,
        displayName: `本地验证-${kind}`,
        clientType: 'ANDROID',
      });
      const principal = await identity.resolvePrincipal(session.accessToken);
      await db.loginIdentity.create({
        data: {
          id: ulid(),
          userId: principal.userId,
          type: 'EMAIL',
          value: `${username}@example.invalid`,
          normalizedValue: `${username}@example.invalid`,
          verifiedAt: CARE_TEST_NOW,
          isPrimary: true,
        },
      });
      return { username, session, principal };
    };
    const owner = await account('owner');
    const caregiver = await account('care');
    const outsider = await account('outside');
    const householdId = ulid();
    const otherHouseholdId = ulid();
    await db.household.createMany({
      data: [
        {
          id: householdId,
          name: '本地照护验证家庭',
          createdByUserId: owner.principal.userId,
          status: 'ACTIVE',
        },
        {
          id: otherHouseholdId,
          name: '隔离验证家庭',
          createdByUserId: outsider.principal.userId,
          status: 'ACTIVE',
        },
      ],
    });
    const ownerRole = await db.role.findUniqueOrThrow({
      where: { scope_code: { scope: 'HOUSEHOLD', code: 'OWNER' } },
    });
    const caregiverRole = await db.role.findUniqueOrThrow({
      where: { scope_code: { scope: 'HOUSEHOLD', code: 'CAREGIVER' } },
    });
    const ownerMemberId = ulid();
    const caregiverMemberId = ulid();
    const otherMemberId = ulid();
    for (const [id, userId, homeId, roleId] of [
      [ownerMemberId, owner.principal.userId, householdId, ownerRole.id],
      [
        caregiverMemberId,
        caregiver.principal.userId,
        householdId,
        caregiverRole.id,
      ],
      [
        otherMemberId,
        outsider.principal.userId,
        otherHouseholdId,
        ownerRole.id,
      ],
    ])
      await db.householdMember.create({
        data: {
          id,
          userId,
          householdId: homeId,
          status: 'ACTIVE',
          roles: { create: { roleId } },
        },
      });
    const recipientId = ulid();
    const emptyRecipientId = ulid();
    const otherRecipientId = ulid();
    await db.careRecipient.createMany({
      data: [
        {
          id: recipientId,
          householdId,
          name: '测试长者甲',
          preferredName: '测试长者甲',
          status: 'ACTIVE',
          timezone: 'Asia/Shanghai',
        },
        {
          id: emptyRecipientId,
          householdId,
          name: '测试长者乙',
          preferredName: '测试长者乙',
          status: 'ACTIVE',
          timezone: 'Asia/Shanghai',
        },
        {
          id: otherRecipientId,
          householdId: otherHouseholdId,
          name: '其他家庭长者',
          preferredName: '其他家庭长者',
          status: 'ACTIVE',
          timezone: 'Asia/Shanghai',
        },
      ],
    });
    const authorityId = ulid();
    await db.recipientMember.create({
      data: {
        id: authorityId,
        householdId,
        recipientId,
        householdMemberId: caregiverMemberId,
        status: 'ACTIVE',
        canViewEvents: true,
        accessLevel: 'FULL',
      },
    });
    const protectedPair = (first: string, second: string) => {
      const encrypted = cipher.encrypt(JSON.stringify([first, second]));
      const split = Math.ceil(encrypted.ciphertext.length / 2);
      return {
        first: new Uint8Array(encrypted.ciphertext.subarray(0, split)),
        second: new Uint8Array(encrypted.ciphertext.subarray(split)),
        contentNonce: new Uint8Array(encrypted.nonce),
        encryptionKeyId: encrypted.encryptionKeyId,
      };
    };
    const routineIds: string[] = [];
    const scheduleIds: string[] = [];
    const createOccurrence = async (
      title: string,
      status: string,
      hour: number,
      foreign = false,
    ) => {
      const content = protectedPair(
        '这是本地测试提醒，不代表真实照护安排。',
        '是否已经完成？',
      );
      const routineId = ulid();
      const scheduleId = ulid();
      routineIds.push(routineId);
      scheduleIds.push(scheduleId);
      const home = foreign ? otherHouseholdId : householdId;
      const elder = foreign ? otherRecipientId : recipientId;
      await db.routine.create({
        data: {
          id: routineId,
          householdId: home,
          recipientId: elder,
          type: 'HYDRATION',
          title,
          status: 'ACTIVE',
          instructionsCiphertext: content.first,
          confirmationQuestionCiphertext: content.second,
          contentNonce: content.contentNonce,
          encryptionKeyId: content.encryptionKeyId,
          schedules: {
            create: {
              id: scheduleId,
              timezone: 'Asia/Shanghai',
              localTimeMinutes: 480,
              weekdayMask: 127,
              startDate: new Date('2026-09-01'),
              graceMinutes: 10,
              familyNoticeMinutes: 30,
            },
          },
        },
      });
      return db.routineOccurrence.create({
        data: {
          id: ulid(),
          householdId: home,
          recipientId: elder,
          routineId,
          scheduleId,
          status,
          scheduledAtUtc: new Date(
            Date.parse('2026-09-19T16:00:00Z') + hour * 3_600_000,
          ),
          scheduledLocalDate: new Date('2026-09-20'),
        },
      });
    };
    const review = await createOccurrence(
      '早餐后饮水',
      'NEEDS_FAMILY_REVIEW',
      8,
    );
    await createOccurrence('上午散步', 'NEEDS_FAMILY_REVIEW', 9);
    await createOccurrence('午间确认', 'AWAITING_CONFIRMATION', 11);
    for (const hour of [13, 14, 15, 16])
      await createOccurrence(`${hour}点饮水`, 'DUE', hour);
    await createOccurrence('已确认的晨间提醒', 'CONFIRMED', 0);
    await createOccurrence('已确认的早餐', 'CONFIRMED', 7);
    await createOccurrence('已结束的提醒', 'EXPIRED', 5);
    await createOccurrence('昨日提醒-不应计入', 'DUE', -0.001);
    await createOccurrence('明日提醒-不应计入', 'DUE', 24);
    await createOccurrence('其他家庭-不应计入', 'DUE', 12, true);
    for (const [index, status] of ['OPEN', 'CLAIMED', 'RESOLVED'].entries()) {
      const content = protectedPair(`测试待办-${status}`, '仅用于本地验证');
      const eventId = ulid();
      await db.careEvent.create({
        data: {
          id: eventId,
          householdId,
          recipientId,
          type: 'FAMILY_REQUESTED',
          severity: 'INFO',
          sourceType: 'USER',
          titleCiphertext: content.first,
          summaryCiphertext: content.second,
          contentNonce: content.contentNonce,
          encryptionKeyId: content.encryptionKeyId,
          dedupeKey: `${run}-${index}`,
          occurredAt: new Date('2026-09-18T00:00:00Z'),
        },
      });
      await db.familyTask.create({
        data: {
          id: ulid(),
          householdId,
          recipientId,
          sourceEventId: eventId,
          status,
          priority: 'NORMAL',
          dueAt: new Date('2026-09-18T00:00:00Z'),
        },
      });
    }
    const cleanup = async () => {
      const homes = [householdId, otherHouseholdId];
      const users = [owner, caregiver, outsider].map(
        (user) => user.principal.userId,
      );
      try {
        await db.$transaction(async (tx) => {
          await tx.familyTask.deleteMany({
            where: { householdId: { in: homes } },
          });
          await tx.careEvent.deleteMany({
            where: { householdId: { in: homes } },
          });
          await tx.routineOccurrence.deleteMany({
            where: { householdId: { in: homes } },
          });
          await tx.routineSchedule.deleteMany({
            where: { id: { in: scheduleIds } },
          });
          await tx.routine.deleteMany({ where: { id: { in: routineIds } } });
          await tx.recipientMember.deleteMany({
            where: { householdId: { in: homes } },
          });
          await tx.careRecipient.deleteMany({
            where: { householdId: { in: homes } },
          });
          await tx.householdMemberRole.deleteMany({
            where: {
              memberId: {
                in: [ownerMemberId, caregiverMemberId, otherMemberId],
              },
            },
          });
          await tx.householdMember.deleteMany({
            where: { householdId: { in: homes } },
          });
          await tx.household.deleteMany({ where: { id: { in: homes } } });
          await tx.userSession.deleteMany({ where: { userId: { in: users } } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      } finally {
        await app.close();
      }
    };
    return {
      app,
      db,
      owner,
      caregiver,
      outsider,
      householdId,
      recipientId,
      emptyRecipientId,
      otherHouseholdId,
      otherRecipientId,
      authorityId,
      review,
      cleanup,
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
