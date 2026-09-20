import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ulid } from 'ulid';
import request from 'supertest';
import { createTodayCareHarness } from './support/today-care-harness';

const describeMySql = process.env.TODAY_CARE_MYSQL_TEST_URL
  ? describe
  : describe.skip;
describeMySql('family task release with real SQL and HTTP', () => {
  let fixture: Awaited<ReturnType<typeof createTodayCareHarness>>;
  beforeAll(async () => {
    fixture = await createTodayCareHarness();
  }, 30_000);
  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  }, 30_000);
  const command = (
    taskId: string,
    action: string,
    token: string,
    version: number,
    key = ulid(),
    home = fixture.householdId,
  ) =>
    request(fixture.app.getHttpServer())
      .post(
        `/openBMB/api/v1/households/${home}/family-tasks/${taskId}/${action}`,
      )
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({
        version,
        ...(action === 'resolve' ? { resolutionCode: 'FAMILY_CONFIRMED' } : {}),
      });

  it('releases, replays once, allows another member to claim, and never completes on release', async () => {
    const task = await fixture.db.familyTask.findFirstOrThrow({
      where: { householdId: fixture.householdId, status: 'CLAIMED' },
    });
    const owner = fixture.owner.session.accessToken;
    const care = fixture.caregiver.session.accessToken;
    await command(task.id, 'release', care, task.version).expect(403);
    await command(
      task.id,
      'release',
      fixture.outsider.session.accessToken,
      task.version,
    ).expect(403);
    await command(
      task.id,
      'release',
      owner,
      task.version,
      ulid(),
      fixture.otherHouseholdId,
    ).expect(404);
    await command(task.id, 'release', owner, task.version + 1).expect(409);
    const key = ulid();
    const first = (
      await command(task.id, 'release', owner, task.version, key).expect(201)
    ).body.data;
    const replay = (
      await command(task.id, 'release', owner, task.version, key).expect(201)
    ).body.data;
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      id: task.id,
      sourceEventId: task.sourceEventId,
      assigneeMemberId: null,
      status: 'OPEN',
      resolvedAt: null,
      resolutionCode: null,
      version: task.version + 1,
    });
    expect(first.dueAt).toBe(task.dueAt?.toISOString() ?? null);
    expect(
      await fixture.db.familyTaskAction.count({
        where: { taskId: task.id, action: 'RELEASE' },
      }),
    ).toBe(1);
    await command(task.id, 'release', owner, first.version).expect(409);
    const claimed = (
      await command(task.id, 'claim', care, first.version).expect(201)
    ).body.data;
    expect(claimed.assigneeMemberId).toBe(fixture.caregiverMemberId);
    await command(task.id, 'release', owner, claimed.version).expect(403);
    const board = (
      await request(fixture.app.getHttpServer())
        .get(
          `/openBMB/api/v1/households/${fixture.householdId}/care-recipients/${fixture.recipientId}/family-task-board`,
        )
        .auth(care, { type: 'bearer' })
        .expect(200)
    ).body.data;
    expect(
      board.tasks.find((t: { id: string }) => t.id === task.id).canRelease,
    ).toBe(true);

    // Concurrent finishing and releasing cannot both commit the same version.
    const results = await Promise.all([
      command(task.id, 'release', care, claimed.version),
      command(task.id, 'resolve', care, claimed.version),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const current = await fixture.db.familyTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(current.version).toBe(claimed.version + 1);
    expect(
      await fixture.db.familyTaskAction.count({ where: { taskId: task.id } }),
    ).toBe(3);
    if (current.status === 'OPEN') {
      expect(current.resolvedAt).toBeNull();
      const next = (
        await command(task.id, 'claim', care, current.version).expect(201)
      ).body.data;
      await command(task.id, 'resolve', care, next.version).expect(201);
    }
    const ended = await fixture.db.familyTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    await command(task.id, 'release', care, ended.version).expect(409);
    await fixture.db.recipientMember.update({
      where: { id: fixture.authorityId },
      data: { canViewEvents: false },
    });
    await command(task.id, 'release', care, ended.version).expect(403);
  });
});
