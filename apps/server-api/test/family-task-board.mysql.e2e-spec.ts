import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ulid } from 'ulid';
import request from 'supertest';
import { createTodayCareHarness } from './support/today-care-harness';

const describeMySql = process.env.TODAY_CARE_MYSQL_TEST_URL
  ? describe
  : describe.skip;
describeMySql(
  'family task board: real SQL, encrypted content and existing commands',
  () => {
    let fixture: Awaited<ReturnType<typeof createTodayCareHarness>>;
    const path = (recipientId = fixture.recipientId) =>
      `/openBMB/api/v1/households/${fixture.householdId}/care-recipients/${recipientId}/family-task-board`;
    const read = (
      token = fixture.owner.session.accessToken,
      recipientId = fixture.recipientId,
    ) =>
      request(fixture.app.getHttpServer())
        .get(path(recipientId))
        .auth(token, { type: 'bearer' });
    beforeAll(async () => {
      fixture = await createTodayCareHarness();
    }, 30_000);
    afterAll(async () => {
      if (fixture) await fixture.cleanup();
    }, 30_000);

    it('requires authentication and recipient authority even for an empty list', async () => {
      await request(fixture.app.getHttpServer()).get(path()).expect(401);
      await read(fixture.outsider.session.accessToken).expect(403);
      await read(
        fixture.owner.session.accessToken,
        fixture.otherRecipientId,
      ).expect(403);
      await read(
        fixture.caregiver.session.accessToken,
        fixture.emptyRecipientId,
      ).expect(403);
      expect(
        (
          await read(
            fixture.owner.session.accessToken,
            fixture.emptyRecipientId,
          ).expect(200)
        ).body.data.tasks,
      ).toEqual([]);
    });
    it('decrypts older source content, resolves ownership and does not write on GET', async () => {
      const before = await fixture.db.familyTask.count();
      const owner = (
        await read().expect(200).expect('Cache-Control', 'no-store')
      ).body.data;
      expect(owner.tasks).toHaveLength(3);
      expect(
        owner.tasks.find((task: { status: string }) => task.status === 'OPEN'),
      ).toMatchObject({
        sourceTitle: '测试待办-OPEN',
        sourceSummary: '仅用于本地验证',
        canClaim: true,
        canFinish: true,
        assigneeDisplayName: null,
      });
      expect(
        owner.tasks.find(
          (task: { status: string }) => task.status === 'CLAIMED',
        ),
      ).toMatchObject({
        assignedToMe: true,
        canFinish: true,
        assigneeDisplayName: '本地验证-owner',
      });
      const caregiver = (
        await read(fixture.caregiver.session.accessToken).expect(200)
      ).body.data;
      expect(
        caregiver.tasks.find(
          (task: { status: string }) => task.status === 'CLAIMED',
        ),
      ).toMatchObject({
        assignedToMe: false,
        canFinish: false,
        canClaim: false,
      });
      expect(await fixture.db.familyTask.count()).toBe(before);
    });
    it('keeps claim idempotency, conflict protection, finish and read-after-write working', async () => {
      const task = await fixture.db.familyTask.findFirstOrThrow({
        where: { householdId: fixture.householdId, status: 'OPEN' },
      });
      const actionPath = `/openBMB/api/v1/households/${fixture.householdId}/family-tasks/${task.id}`;
      const claimKey = ulid();
      const claim = () =>
        request(fixture.app.getHttpServer())
          .post(`${actionPath}/claim`)
          .auth(fixture.caregiver.session.accessToken, { type: 'bearer' })
          .set('Idempotency-Key', claimKey)
          .send({ version: 0 });
      await claim().expect(201);
      await claim().expect(201);
      expect(
        await fixture.db.familyTaskAction.count({ where: { taskId: task.id } }),
      ).toBe(1);
      await request(fixture.app.getHttpServer())
        .post(`${actionPath}/claim`)
        .auth(fixture.owner.session.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', ulid())
        .send({ version: 0 })
        .expect(409);
      const current = (
        await read(fixture.caregiver.session.accessToken).expect(200)
      ).body.data.tasks.find((item: { id: string }) => item.id === task.id);
      expect(current).toMatchObject({
        status: 'CLAIMED',
        assignedToMe: true,
        canFinish: true,
        version: 1,
      });
      await request(fixture.app.getHttpServer())
        .post(`${actionPath}/resolve`)
        .auth(fixture.owner.session.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', ulid())
        .send({ version: 1, resolutionCode: 'FAMILY_CONFIRMED' })
        .expect(403)
        .expect((response) => {
          expect(response.body.code).toBe('FAMILY_TASK_ASSIGNEE_CONFLICT');
        });
      await request(fixture.app.getHttpServer())
        .post(`${actionPath}/resolve`)
        .auth(fixture.caregiver.session.accessToken, { type: 'bearer' })
        .set('Idempotency-Key', ulid())
        .send({
          version: 1,
          resolutionCode: 'FAMILY_CONFIRMED',
          note: '已联系确认，仅测试',
        })
        .expect(201);
      expect(
        (await read().expect(200)).body.data.tasks.find(
          (item: { id: string }) => item.id === task.id,
        ),
      ).toMatchObject({
        status: 'RESOLVED',
        canFinish: false,
        canClaim: false,
        resolutionNote: '已联系确认，仅测试',
        assigneeDisplayName: '本地验证-care',
      });
      const old = await request(fixture.app.getHttpServer())
        .get(`/openBMB/api/v1/households/${fixture.householdId}/family-tasks`)
        .auth(fixture.owner.session.accessToken, { type: 'bearer' })
        .expect(200);
      expect(
        old.body.data.find((item: { id: string }) => item.id === task.id),
      ).toMatchObject({ status: 'RESOLVED', version: 2 });
    });
    it('uses a safe former-member label without leaking a departed user name', async () => {
      await fixture.db.householdMember.update({
        where: { id: fixture.caregiverMemberId },
        data: { status: 'LEFT' },
      });
      const items = (await read().expect(200)).body.data.tasks;
      expect(
        items.find(
          (item: { assigneeMemberId: string }) =>
            item.assigneeMemberId === fixture.caregiverMemberId,
        ).assigneeDisplayName,
      ).toBe('原家庭成员');
      await fixture.db.householdMember.update({
        where: { id: fixture.caregiverMemberId },
        data: { status: 'ACTIVE' },
      });
    });
    it('rechecks VIEW_EVENTS after a grant is revoked', async () => {
      await fixture.db.recipientMember.update({
        where: { id: fixture.authorityId },
        data: { canViewEvents: false },
      });
      await read(fixture.caregiver.session.accessToken).expect(403);
    });
  },
);
