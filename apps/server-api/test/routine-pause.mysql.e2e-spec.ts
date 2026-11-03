import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ulid } from 'ulid';
import {
  createTodayCareHarness,
  CARE_TEST_NOW,
} from './support/today-care-harness';
import { PrismaOccurrenceScheduler } from '../src/modules/care-workflow/occurrence-scheduler.application';
import { CareWorkflowApplicationService } from '../src/modules/care-workflow/care-workflow.application.service';
import { CARE_WORKFLOW_CONTENT_CIPHER } from '../src/modules/care-workflow/care-workflow.constants';
import { Prisma } from '../src/infrastructure/database/generated/prisma/client';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../src/modules/household/domain/household-access.policy';

const describeMySql = process.env.TODAY_CARE_MYSQL_TEST_URL
  ? describe
  : describe.skip;
describeMySql('routine pause/resume: real HTTP and MySQL', () => {
  let fixture: Awaited<ReturnType<typeof createTodayCareHarness>>;
  const ids: string[] = [];
  const keys: string[] = [];
  const key = () => {
    const value = randomUUID();
    keys.push(value);
    return value;
  };
  const collection = () =>
    `/openBMB/api/v1/households/${fixture.householdId}/care-recipients/${fixture.emptyRecipientId}/routines`;
  const endpoint = (id: string) =>
    `/openBMB/api/v1/households/${fixture.householdId}/routines/${id}`;
  const auth = () => fixture.owner.session.accessToken;
  const schedule = {
    timezone: 'Asia/Shanghai',
    localTimeMinutes: 1200,
    weekdayMask: 127,
    startDate: '2026-09-01',
    endDate: null,
    graceMinutes: 10,
    familyNoticeMinutes: 20,
  };
  async function create(override = {}) {
    const result = await request(fixture.app.getHttpServer())
      .post(collection())
      .auth(auth(), { type: 'bearer' })
      .send({
        type: 'ACTIVITY',
        title: '暂停恢复隔离验证',
        instructions: '合成日程，非真实照护',
        confirmationQuestion: '完成了吗？',
        schedule: { ...schedule, ...override },
      })
      .expect(201);
    ids.push(result.body.data.id);
    return result.body.data;
  }
  const command = (
    id: string,
    action: string,
    version: number,
    receipt = key(),
  ) =>
    request(fixture.app.getHttpServer())
      .post(`${endpoint(id)}/${action}`)
      .auth(auth(), { type: 'bearer' })
      .set('Idempotency-Key', receipt)
      .send({ version });
  function scheduler(id: string, database = fixture.db) {
    return new PrismaOccurrenceScheduler(
      {
        routineSchedule: {
          findMany: (query: { where: object }) =>
            fixture.db.routineSchedule.findMany({
              ...query,
              where: { ...query.where, routineId: id },
            }),
        },
        routineOccurrence: {
          findMany: (query: { where: object }) =>
            fixture.db.routineOccurrence.findMany({
              ...query,
              where: { ...query.where, routineId: id },
            }),
        },
        $transaction: database.$transaction.bind(database),
      } as never,
      fixture.app.get(CARE_WORKFLOW_CONTENT_CIPHER),
    );
  }

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  // Gate only the actual routine lock acquisition, not a simulated in-memory lock.
  // Each competing transaction has a distinct MySQL connection; a third query
  // observes performance_schema.data_lock_waits before releasing the winner.
  function gatedDatabase() {
    const acquired = deferred();
    const release = deferred();
    const database = new Proxy(fixture.db, {
      get(target, property) {
        if (property === '$transaction')
          return <T>(
            work: (tx: Prisma.TransactionClient) => Promise<T>,
            options: object,
          ) =>
            target.$transaction(
              async (tx) =>
                work(
                  new Proxy(tx, {
                    get(transaction, field) {
                      if (field === '$queryRaw')
                        return async (query: Prisma.Sql) => {
                          const result = await transaction.$queryRaw(query);
                          acquired.resolve();
                          await release.promise;
                          return result;
                        };
                      return Reflect.get(transaction, field);
                    },
                  }),
                ),
              { ...options, timeout: 10000 },
            );
        return Reflect.get(target, property);
      },
    });
    const workflow = new CareWorkflowApplicationService(
      database as PrismaService,
      fixture.app.get(HouseholdAccessPolicy),
      fixture.app.get(CARE_WORKFLOW_CONTENT_CIPHER),
      { now: () => CARE_TEST_NOW },
    );
    return { database, workflow, acquired, release };
  }
  async function waitForDatabaseLock(routineId: string) {
    const deadline = Date.now() + 3000;
    do {
      const rows = await fixture.db.$queryRaw<
        Array<{ waiting: bigint }>
      >(Prisma.sql`
        SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits w
        JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID
        WHERE l.OBJECT_SCHEMA='lighthouse_iteration_test' AND l.OBJECT_NAME='routines'
          AND l.LOCK_DATA LIKE ${`%${routineId}%`}`);
      if (Number(rows[0].waiting) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error('Expected an observed MySQL routine row lock wait');
  }
  beforeAll(async () => {
    fixture = await createTodayCareHarness();
  }, 30000);

  it.each(['generation', 'pause'])(
    '%s wins the row lock: no active occurrence escapes pause',
    async (winner) => {
      const routine = await create();
      const gate = gatedDatabase();
      const workflow = fixture.app.get(CareWorkflowApplicationService);
      const window = {
        windowStartUtc: new Date('2026-09-20T00:00:00Z'),
        windowEndUtc: new Date('2026-09-21T00:00:00Z'),
      };
      const pause = (service: CareWorkflowApplicationService) =>
        service.pauseRoutine(
          fixture.owner.principal,
          fixture.householdId,
          routine.id,
          { version: 0, idempotencyKey: key() },
        );
      const first =
        winner === 'generation'
          ? scheduler(routine.id, gate.database).generateOccurrences(window)
          : pause(gate.workflow);
      await gate.acquired.promise;
      const second =
        winner === 'generation'
          ? pause(workflow)
          : scheduler(routine.id).generateOccurrences(window);
      const outcomes = Promise.allSettled([first, second]);
      try {
        await waitForDatabaseLock(routine.id);
      } finally {
        gate.release.resolve();
      }
      expect(
        (await outcomes).every((result) => result.status === 'fulfilled'),
      ).toBe(true);
      const history = (
        await workflow.listOccurrences(
          fixture.owner.principal,
          fixture.householdId,
          fixture.emptyRecipientId,
        )
      ).filter((o) => o.routineId === routine.id);
      expect(history).toHaveLength(winner === 'generation' ? 1 : 0);
      expect(
        history.every(
          (o) => o.status === 'EXPIRED' && o.closureReason === 'ROUTINE_PAUSED',
        ),
      ).toBe(true);
    },
    15000,
  );

  it.each(['confirmation', 'pause', 'escalation'])(
    '%s wins the row lock: confirmation/review evidence follows commit order',
    async (winner) => {
      const routine = await create();
      const occurrence = await fixture.db.routineOccurrence.create({
        data: {
          id: ulid(),
          householdId: fixture.householdId,
          recipientId: fixture.emptyRecipientId,
          routineId: routine.id,
          scheduleId: routine.schedules[0].id,
          scheduledAtUtc: new Date('2026-09-20T03:00:00Z'),
          scheduledLocalDate: new Date('2026-09-20'),
          status: 'AWAITING_CONFIRMATION',
          escalationAt: new Date('2026-09-20T03:30:00Z'),
        },
      });
      const gate = gatedDatabase();
      const workflow = fixture.app.get(CareWorkflowApplicationService);
      const pause = (service: CareWorkflowApplicationService) =>
        service.pauseRoutine(
          fixture.owner.principal,
          fixture.householdId,
          routine.id,
          { version: 0, idempotencyKey: key() },
        );
      const confirm = (service: CareWorkflowApplicationService) =>
        service.confirmOccurrence(
          fixture.owner.principal,
          fixture.householdId,
          occurrence.id,
          { version: 0, idempotencyKey: key(), source: 'RECIPIENT_BUTTON' },
        );
      const first =
        winner === 'confirmation'
          ? confirm(gate.workflow)
          : winner === 'escalation'
            ? scheduler(routine.id, gate.database).advanceOccurrences({
                now: CARE_TEST_NOW,
              })
            : pause(gate.workflow);
      await gate.acquired.promise;
      const second = winner === 'pause' ? confirm(workflow) : pause(workflow);
      const outcomes = Promise.allSettled([first, second]);
      try {
        await waitForDatabaseLock(routine.id);
      } finally {
        gate.release.resolve();
      }
      const results = await outcomes;
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe(
        winner === 'pause' ? 'rejected' : 'fulfilled',
      );
      const history = await workflow.listOccurrences(
        fixture.owner.principal,
        fixture.householdId,
        fixture.emptyRecipientId,
      );
      expect(history.find((o) => o.id === occurrence.id)?.status).toBe(
        winner === 'confirmation'
          ? 'CONFIRMED'
          : winner === 'escalation'
            ? 'NEEDS_FAMILY_REVIEW'
            : 'EXPIRED',
      );
      if (winner === 'escalation') {
        expect(
          await workflow.listFamilyTasks(
            fixture.owner.principal,
            fixture.householdId,
            { recipientId: fixture.emptyRecipientId },
          ),
        ).toEqual(
          expect.arrayContaining([expect.objectContaining({ status: 'OPEN' })]),
        );
      }
    },
    15000,
  );
  afterAll(async () => {
    if (!fixture) return;
    try {
      await fixture.db.careCommandReceipt.deleteMany({
        where: { idempotencyKey: { in: keys } },
      });
      const events = await fixture.db.careEvent.findMany({
        where: { occurrence: { routineId: { in: ids } } },
        select: { id: true },
      });
      const eventIds = events.map((e) => e.id);
      const tasks = await fixture.db.familyTask.findMany({
        where: { sourceEventId: { in: eventIds } },
        select: { id: true },
      });
      await fixture.db.familyTaskAction.deleteMany({
        where: { taskId: { in: tasks.map((t) => t.id) } },
      });
      await fixture.db.familyTask.deleteMany({
        where: { sourceEventId: { in: eventIds } },
      });
      await fixture.db.careEvent.deleteMany({
        where: { id: { in: eventIds } },
      });
      await fixture.db.routineConfirmation.deleteMany({
        where: { occurrence: { routineId: { in: ids } } },
      });
      const occurrences = await fixture.db.routineOccurrence.findMany({
        where: { routineId: { in: ids } },
        select: { id: true },
      });
      await fixture.db.outboxEvent.deleteMany({
        where: {
          aggregateId: {
            in: [
              ...ids,
              ...eventIds,
              ...tasks.map((t) => t.id),
              ...occurrences.map((o) => o.id),
            ],
          },
        },
      });
      await fixture.db.routineOccurrence.deleteMany({
        where: { routineId: { in: ids } },
      });
      await fixture.db.routineSchedule.deleteMany({
        where: { routineId: { in: ids } },
      });
      await fixture.db.routine.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await fixture.cleanup();
    }
  }, 30000);

  it('keeps default lists ACTIVE-only, validates opt-in/key/version and denies outsiders', async () => {
    const routine = await create();
    const http = fixture.app.getHttpServer();
    await request(http)
      .post(`${endpoint(routine.id)}/pause`)
      .send({ version: 0 })
      .expect(401);
    await request(http)
      .post(`${endpoint(routine.id)}/pause`)
      .auth(auth(), { type: 'bearer' })
      .send({ version: 0 })
      .expect(400);
    await request(http)
      .post(`${endpoint(routine.id)}/pause`)
      .auth(fixture.outsider.session.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', key())
      .send({ version: 0 })
      .expect(403);
    await request(http)
      .get(`${collection()}?includePaused=1`)
      .auth(auth(), { type: 'bearer' })
      .expect(400);
    await command(routine.id, 'pause', 0).expect(200);
    const normal = await request(http)
      .get(collection())
      .auth(auth(), { type: 'bearer' })
      .expect(200);
    expect(
      normal.body.data.find((r: { id: string }) => r.id === routine.id),
    ).toBeUndefined();
    const management = await request(http)
      .get(`${collection()}?includePaused=true`)
      .auth(auth(), { type: 'bearer' })
      .expect(200);
    expect(
      management.body.data.find((r: { id: string }) => r.id === routine.id),
    ).toMatchObject({
      status: 'PAUSED',
      schedules: [{ localTimeMinutes: 1200 }],
    });
  });

  it('reauthorizes replay after a caregiver loses management authority', async () => {
    const routine = await create();
    const grant = await fixture.db.recipientMember.create({
      data: {
        id: ulid(),
        householdId: fixture.householdId,
        recipientId: fixture.emptyRecipientId,
        householdMemberId: fixture.caregiverMemberId,
        status: 'ACTIVE',
        canViewEvents: true,
        canManageRoutine: true,
        accessLevel: 'FULL',
      },
    });
    const receipt = key();
    const pause = () =>
      request(fixture.app.getHttpServer())
        .post(`${endpoint(routine.id)}/pause`)
        .auth(fixture.caregiver.session.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', receipt)
        .send({ version: 0 });
    await pause().expect(200);
    await fixture.db.recipientMember.update({
      where: { id: grant.id },
      data: { canManageRoutine: false },
    });
    await pause().expect(403);
    await request(fixture.app.getHttpServer())
      .post(`${endpoint(routine.id)}/resume`)
      .auth(fixture.caregiver.session.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', key())
      .send({ version: 1 })
      .expect(403);
  });

  it('rolls the entire pause back if writing its audit event fails', async () => {
    const routine = await create();
    await scheduler(routine.id).generateOccurrences({
      windowStartUtc: new Date('2026-09-20T00:00:00Z'),
      windowEndUtc: new Date('2026-09-21T00:00:00Z'),
    });
    const database = new Proxy(fixture.db, {
      get(target, property) {
        if (property === '$transaction')
          return <T>(
            work: (tx: Prisma.TransactionClient) => Promise<T>,
            options: object,
          ) =>
            target.$transaction(
              (tx) =>
                work(
                  new Proxy(tx, {
                    get(transaction, field) {
                      if (field === 'outboxEvent')
                        return {
                          create: () =>
                            Promise.reject(new Error('injected audit failure')),
                        };
                      return Reflect.get(transaction, field);
                    },
                  }),
                ),
              options,
            );
        return Reflect.get(target, property);
      },
    });
    const workflow = new CareWorkflowApplicationService(
      database,
      fixture.app.get(HouseholdAccessPolicy),
      fixture.app.get(CARE_WORKFLOW_CONTENT_CIPHER),
      { now: () => CARE_TEST_NOW },
    );
    await expect(
      workflow.pauseRoutine(
        fixture.owner.principal,
        fixture.householdId,
        routine.id,
        { version: 0, idempotencyKey: key() },
      ),
    ).rejects.toThrow('injected audit failure');
    const current = (
      await workflow.listRoutines(
        fixture.owner.principal,
        fixture.householdId,
        fixture.emptyRecipientId,
      )
    ).find((r) => r.id === routine.id);
    expect(current).toMatchObject({
      status: 'ACTIVE',
      version: 0,
      schedules: [{ id: routine.schedules[0].id }],
    });
    const history = (
      await workflow.listOccurrences(
        fixture.owner.principal,
        fixture.householdId,
        fixture.emptyRecipientId,
      )
    ).filter((o) => o.routineId === routine.id);
    expect(history).toEqual([
      expect.objectContaining({
        status: 'DUE',
        version: 0,
        closureReason: null,
      }),
    ]);
  });

  it('closes 105 pending records in one command while preserving review, confirmation and tasks', async () => {
    const routine = await create();
    const workflow = fixture.app.get(CareWorkflowApplicationService);
    const rows = Array.from({ length: 108 }, (_, index) => ({
      id: ulid(),
      householdId: fixture.householdId,
      recipientId: fixture.emptyRecipientId,
      routineId: routine.id,
      scheduleId: routine.schedules[0].id,
      scheduledAtUtc: new Date(CARE_TEST_NOW.getTime() + index * 60000),
      scheduledLocalDate: new Date('2026-09-20'),
      status:
        index < 105
          ? index % 2
            ? 'DUE'
            : 'AWAITING_CONFIRMATION'
          : ['NEEDS_FAMILY_REVIEW', 'CONFIRMED', 'EXPIRED'][index - 105],
    }));
    await fixture.db.routineOccurrence.createMany({ data: rows });
    const beforeTasks = await workflow.listFamilyTasks(
      fixture.owner.principal,
      fixture.householdId,
      {},
    );
    await command(routine.id, 'pause', 0).expect(200);
    const history = (
      await workflow.listOccurrences(
        fixture.owner.principal,
        fixture.householdId,
        fixture.emptyRecipientId,
      )
    ).filter((o) => o.routineId === routine.id);
    expect(
      history.filter((o) => o.closureReason === 'ROUTINE_PAUSED'),
    ).toHaveLength(105);
    expect(
      history
        .filter((o) => o.closureReason === 'ROUTINE_PAUSED')
        .every(
          (o) => o.status === 'EXPIRED' && o.version === 1 && !o.completedAt,
        ),
    ).toBe(true);
    expect(history.find((o) => o.id === rows[105].id)?.status).toBe(
      'NEEDS_FAMILY_REVIEW',
    );
    expect(history.find((o) => o.id === rows[106].id)?.status).toBe(
      'CONFIRMED',
    );
    expect(
      await workflow.listFamilyTasks(
        fixture.owner.principal,
        fixture.householdId,
        {},
      ),
    ).toEqual(beforeTasks);
    await expect(
      workflow.confirmOccurrence(
        fixture.owner.principal,
        fixture.householdId,
        rows[0].id,
        { version: 0, idempotencyKey: key(), source: 'RECIPIENT_BUTTON' },
      ),
    ).rejects.toMatchObject({
      response: { code: 'CARE_WORKFLOW_VERSION_CONFLICT' },
    });
    const verified = await workflow.familyVerifyOccurrence(
      fixture.owner.principal,
      fixture.householdId,
      rows[105].id,
      { version: 0, idempotencyKey: key(), verified: true },
    );
    expect(verified.status).toBe('CONFIRMED');
  });

  it('pre-generates tonight, pauses and resumes exactly one new valid occurrence without backfill', async () => {
    const routine = await create();
    const worker = scheduler(routine.id);
    const window = {
      windowStartUtc: new Date('2026-09-20T00:00:00Z'),
      windowEndUtc: new Date('2026-09-21T00:00:00Z'),
    };
    expect(await worker.generateOccurrences(window)).toMatchObject({
      created: 1,
    });
    const pauseKey = key();
    const paused = await command(routine.id, 'pause', 0, pauseKey).expect(200);
    const resumed = await command(routine.id, 'resume', 1).expect(200);
    expect(resumed.body.data.schedules[0].id).not.toBe(routine.schedules[0].id);
    expect(await worker.generateOccurrences(window)).toMatchObject({
      created: 1,
    });
    expect(await worker.generateOccurrences(window)).toMatchObject({
      created: 0,
    });
    const history = await fixture.app
      .get(CareWorkflowApplicationService)
      .listOccurrences(
        fixture.owner.principal,
        fixture.householdId,
        fixture.emptyRecipientId,
      );
    expect(
      history.filter((o) => o.routineId === routine.id && o.status === 'DUE'),
    ).toHaveLength(1);
    expect(
      history.filter(
        (o) =>
          o.routineId === routine.id && o.closureReason === 'ROUTINE_PAUSED',
      ),
    ).toHaveLength(1);
    await request(fixture.app.getHttpServer())
      .delete(`${endpoint(routine.id)}?version=2`)
      .auth(auth(), { type: 'bearer' })
      .expect(204);
    expect(
      (await command(routine.id, 'pause', 0, pauseKey).expect(200)).body.data,
    ).toEqual(paused.body.data);
    await command(routine.id, 'resume', 3).expect(404);
  });

  it('keeps an expired one-time rule paused until edited, then supports keyed replay and concurrent versions', async () => {
    const routine = await create({
      startDate: '2026-09-19',
      endDate: '2026-09-19',
    });
    const responses = await Promise.all([
      command(routine.id, 'pause', 0),
      command(routine.id, 'pause', 0),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const rejected = await command(routine.id, 'resume', 1).expect(409);
    expect(rejected.body.code).toBe('ROUTINE_NO_FUTURE_OCCURRENCE');
    const edit = await request(fixture.app.getHttpServer())
      .patch(endpoint(routine.id))
      .auth(auth(), { type: 'bearer' })
      .set('Idempotency-Key', key())
      .send({ version: 1, schedule })
      .expect(200);
    expect(edit.body.data.status).toBe('PAUSED');
    expect(
      await fixture.db.routineSchedule.count({
        where: { routineId: routine.id, active: true },
      }),
    ).toBe(0);
    const receipt = key();
    const resumed = await command(routine.id, 'resume', 2, receipt).expect(200);
    expect(
      (await command(routine.id, 'resume', 2, receipt).expect(200)).body.data,
    ).toEqual(resumed.body.data);
    await command(routine.id, 'resume', 3, receipt).expect(409);
  });
});
