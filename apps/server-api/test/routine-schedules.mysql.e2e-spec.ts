import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTodayCareHarness } from './support/today-care-harness';
import { PrismaOccurrenceScheduler } from '../src/modules/care-workflow/occurrence-scheduler.application';
import { CARE_WORKFLOW_CONTENT_CIPHER } from '../src/modules/care-workflow/care-workflow.constants';

const describeMySql = process.env.TODAY_CARE_MYSQL_TEST_URL
  ? describe
  : describe.skip;
describeMySql(
  'routine schedules: authenticated commands and real MySQL scheduling',
  () => {
    let fixture: Awaited<ReturnType<typeof createTodayCareHarness>>;
    const createdIds: string[] = [];
    const receiptKeys: string[] = [];
    const schedule = {
      timezone: 'Asia/Shanghai',
      localTimeMinutes: 540,
      weekdayMask: 127,
      startDate: '2026-09-26',
      endDate: '2026-09-26',
      graceMinutes: 5,
      familyNoticeMinutes: 15,
    };
    const body = {
      type: 'APPOINTMENT',
      title: '单次预约测试',
      instructions: '仅隔离测试',
      confirmationQuestion: '完成了吗？',
      schedule,
    };
    const collection = () =>
      `/openBMB/api/v1/households/${fixture.householdId}/care-recipients/${fixture.emptyRecipientId}/routines`;
    const endpoint = (id: string) =>
      `/openBMB/api/v1/households/${fixture.householdId}/routines/${id}`;
    beforeAll(async () => {
      fixture = await createTodayCareHarness();
    }, 30_000);
    afterAll(async () => {
      if (!fixture) return;
      try {
        await fixture.db.careCommandReceipt.deleteMany({
          where: { idempotencyKey: { in: receiptKeys } },
        });
        // Only resources created by this suite; the fixture owns its remaining cleanup.
        await fixture.db.routineOccurrence.deleteMany({
          where: { routineId: { in: createdIds } },
        });
        await fixture.db.routineSchedule.deleteMany({
          where: { routineId: { in: createdIds } },
        });
        await fixture.db.outboxEvent.deleteMany({
          where: { aggregateType: 'ROUTINE', aggregateId: { in: createdIds } },
        });
        await fixture.db.routine.deleteMany({
          where: { id: { in: createdIds } },
        });
      } finally {
        await fixture.cleanup();
      }
    }, 30_000);

    it('rejects unauthenticated, unauthorized and non-firing schedules', async () => {
      const http = fixture.app.getHttpServer();
      await request(http).post(collection()).send(body).expect(401);
      await request(http)
        .post(collection())
        .auth(fixture.outsider.session.accessToken, { type: 'bearer' })
        .send(body)
        .expect(403);
      await request(http)
        .post(collection())
        .auth(fixture.owner.session.accessToken, { type: 'bearer' })
        .send({ ...body, schedule: { ...schedule, weekdayMask: 62 } })
        .expect(400);
      expect(
        await fixture.db.routine.count({
          where: { recipientId: fixture.emptyRecipientId },
        }),
      ).toBe(0);
    });
    it('replays identical edits without a second version and rejects key reuse or unauthorized replay', async () => {
      const http = fixture.app.getHttpServer();
      const token = fixture.owner.session.accessToken;
      const created = (
        await request(http)
          .post(collection())
          .auth(token, { type: 'bearer' })
          .send(body)
          .expect(201)
      ).body.data;
      createdIds.push(created.id);
      const key = randomUUID();
      receiptKeys.push(key);
      const edit = {
        title: '重试只执行一次',
        version: created.version,
        schedule,
      };
      const patch = () =>
        request(http)
          .patch(endpoint(created.id))
          .auth(token, { type: 'bearer' })
          .set('Idempotency-Key', key)
          .send(edit);
      const [first, retry] = await Promise.all([patch(), patch()]);
      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(retry.body.data).toEqual(first.body.data);
      expect(first.body.data.version).toBe(created.version + 1);
      expect(
        await fixture.db.routineSchedule.count({
          where: { routineId: created.id },
        }),
      ).toBe(1);
      await request(http)
        .patch(endpoint(created.id))
        .auth(token, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send({ ...edit, title: '同键不同内容' })
        .expect(409);
      await request(http)
        .patch(endpoint(created.id))
        .auth(fixture.outsider.session.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(edit)
        .expect(403);
      const record = await fixture.db.careCommandReceipt.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      expect(
        Buffer.from(record.resultCiphertext).toString('utf8'),
      ).not.toContain(edit.title);
    });
    it('preserves an unchanged schedule, versions an edit, and generates only the intended dates', async () => {
      const http = fixture.app.getHttpServer();
      const token = fixture.owner.session.accessToken;
      const created = (
        await request(http)
          .post(collection())
          .auth(token, { type: 'bearer' })
          .send(body)
          .expect(201)
      ).body.data;
      createdIds.push(created.id);
      const same = (
        await request(http)
          .patch(endpoint(created.id))
          .auth(token, { type: 'bearer' })
          .send({ title: '改标题不改排期', version: created.version, schedule })
          .expect(200)
      ).body.data;
      expect(same.schedules[0].id).toBe(created.schedules[0].id);
      expect(same.schedules[0].scheduleVersion).toBe(1);
      await request(http)
        .patch(endpoint(created.id))
        .auth(token, { type: 'bearer' })
        .send({ title: '旧版本不应覆盖', version: created.version, schedule })
        .expect(409);
      // Real scheduler and database writes; constrain selection to this suite's IDs
      // so unrelated preview fixtures in the shared local test database are untouched.
      const scheduler = new PrismaOccurrenceScheduler(
        {
          routineSchedule: {
            findMany: (query: { where: object; include: object }) =>
              fixture.db.routineSchedule.findMany({
                ...query,
                where: { ...query.where, routineId: created.id },
              }),
          },
          routineOccurrence: fixture.db.routineOccurrence,
        } as never,
        fixture.app.get(CARE_WORKFLOW_CONTENT_CIPHER),
      );
      const window = {
        windowStartUtc: new Date('2026-09-20'),
        windowEndUtc: new Date('2026-09-29'),
      };
      expect(await scheduler.generateOccurrences(window)).toMatchObject({
        created: 1,
      });
      expect(await scheduler.generateOccurrences(window)).toMatchObject({
        created: 0,
      });
      const weekly = (
        await request(http)
          .patch(endpoint(created.id))
          .auth(token, { type: 'bearer' })
          .send({
            version: same.version,
            schedule: {
              ...schedule,
              weekdayMask: 62,
              startDate: '2026-09-21',
              endDate: '2026-09-27',
            },
          })
          .expect(200)
      ).body.data;
      expect(weekly.schedules[0].id).not.toBe(same.schedules[0].id);
      expect(weekly.schedules[0].scheduleVersion).toBe(2);
      expect(
        await fixture.db.routineSchedule.count({
          where: { routineId: created.id, active: true },
        }),
      ).toBe(1);
      expect(await scheduler.generateOccurrences(window)).toMatchObject({
        created: 5,
      });
      const rows = await fixture.db.routineOccurrence.findMany({
        where: { scheduleId: weekly.schedules[0].id },
        orderBy: { scheduledAtUtc: 'asc' },
      });
      expect(
        rows.map((row) => row.scheduledLocalDate.toISOString().slice(0, 10)),
      ).toEqual([
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
      ]);
      expect(rows[0].escalationAt?.toISOString()).toBe(
        '2026-09-21T01:20:00.000Z',
      );
      // Old records remain available rather than being erased by the edit.
      expect(
        await fixture.db.routineOccurrence.count({
          where: { scheduleId: same.schedules[0].id },
        }),
      ).toBe(1);
    });
  },
);
