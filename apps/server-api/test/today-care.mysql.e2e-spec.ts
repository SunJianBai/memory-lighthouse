import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { createTodayCareHarness } from './support/today-care-harness';

const describeMySql = process.env.TODAY_CARE_MYSQL_TEST_URL
  ? describe
  : describe.skip;

describeMySql('today care: real MySQL and authenticated HTTP', () => {
  let fixture: Awaited<ReturnType<typeof createTodayCareHarness>>;
  const path = (recipientId = fixture.recipientId) =>
    `/openBMB/api/v1/households/${fixture.householdId}/care-recipients/${recipientId}/today-care`;
  beforeAll(async () => {
    fixture = await createTodayCareHarness();
  }, 30_000);
  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  }, 30_000);

  it('rejects anonymous requests', async () => {
    await request(fixture.app.getHttpServer()).get(path()).expect(401);
  });
  it('returns exact totals, day boundaries, oldest open tasks, and a bounded priority list', async () => {
    const before = await fixture.db.routineOccurrence.count();
    const result = await request(fixture.app.getHttpServer())
      .get(path())
      .auth(fixture.owner.session.accessToken, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(result.body.data).toMatchObject({
      householdId: fixture.householdId,
      recipientId: fixture.recipientId,
      localDate: '2026-09-20',
      counts: {
        total: 10,
        confirmed: 2,
        needsReview: 2,
        pending: 5,
        expired: 1,
      },
      openTaskCount: 2,
    });
    expect(result.body.data.items).toHaveLength(5);
    expect(
      result.body.data.items.map((item: { title: string }) => item.title),
    ).toEqual(['早餐后饮水', '上午散步', '午间确认', '13点饮水', '14点饮水']);
    expect(await fixture.db.routineOccurrence.count()).toBe(before);
  });
  it('isolates empty recipients and rejects cross-household identifiers', async () => {
    const result = await request(fixture.app.getHttpServer())
      .get(path(fixture.emptyRecipientId))
      .auth(fixture.owner.session.accessToken, { type: 'bearer' })
      .expect(200);
    expect(result.body.data).toMatchObject({
      counts: { total: 0 },
      openTaskCount: 0,
      items: [],
    });
    await request(fixture.app.getHttpServer())
      .get(path(fixture.otherRecipientId))
      .auth(fixture.owner.session.accessToken, { type: 'bearer' })
      .expect(403);
    await request(fixture.app.getHttpServer())
      .get(path())
      .auth(fixture.outsider.session.accessToken, { type: 'bearer' })
      .expect(403);
  });
  it('rechecks caregiver permission after revocation', async () => {
    await request(fixture.app.getHttpServer())
      .get(path())
      .auth(fixture.caregiver.session.accessToken, { type: 'bearer' })
      .expect(200);
    await fixture.db.recipientMember.update({
      where: { id: fixture.authorityId },
      data: { canViewEvents: false },
    });
    await request(fixture.app.getHttpServer())
      .get(path())
      .auth(fixture.caregiver.session.accessToken, { type: 'bearer' })
      .expect(403);
  });
  it('keeps the existing occurrence API compatible with the new summary', async () => {
    const oldPath = path().replace('/today-care', '/occurrences');
    const result = await request(fixture.app.getHttpServer())
      .get(oldPath)
      .query({
        from: '2026-09-19T16:00:00.000Z',
        to: '2026-09-20T15:59:59.999Z',
      })
      .auth(fixture.owner.session.accessToken, { type: 'bearer' })
      .expect(200);
    expect(result.body.data).toHaveLength(10);
    expect(result.body.data[0]).toMatchObject({
      contentProvenance: 'FAMILY_ENTERED_VERBATIM',
      instructions: '这是本地测试提醒，不代表真实照护安排。',
    });
  });
});
