import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { ulid } from 'ulid';
import { CARE_WORKFLOW_CONTENT_CIPHER } from '../src/modules/care-workflow/care-workflow.constants';
import type { CareWorkflowContentCipher } from '../src/modules/care-workflow/ports/content-cipher.port';
import { createTodayCareHarness } from './support/today-care-harness';

const describeMySql = process.env.TODAY_CARE_MYSQL_TEST_URL
  ? describe
  : describe.skip;

describeMySql(
  'care history: actual MySQL pagination and authenticated HTTP',
  () => {
    let fixture: Awaited<ReturnType<typeof createTodayCareHarness>>;
    const eventIds: string[] = [];
    let oldOccurrenceId: string;
    const dates = { startDate: '2026-09-01', endDate: '2026-09-01' };
    const path = (kind: string, recipient = fixture.recipientId) =>
      `/openBMB/api/v1/households/${fixture.householdId}/care-recipients/${recipient}/${kind}/history`;
    const read = (
      kind: string,
      query: object = {},
      token = fixture.owner.session.accessToken,
      recipient = fixture.recipientId,
    ) =>
      request(fixture.app.getHttpServer())
        .get(path(kind, recipient))
        .auth(token, { type: 'bearer' })
        .query(query);

    beforeAll(async () => {
      fixture = await createTodayCareHarness();
      const cipher = fixture.app.get<CareWorkflowContentCipher>(
        CARE_WORKFLOW_CONTENT_CIPHER,
      );
      // All rows have the same instant: IDs must provide the stable tie breaker.
      for (let index = 0; index < 67; index++) {
        const id = ulid();
        const content = cipher.encrypt(
          JSON.stringify([`历史记录 ${index + 1}`, '隔离测试记录']),
        );
        if (index < 65) eventIds.push(id);
        await fixture.db.careEvent.create({
          data: {
            id,
            householdId: fixture.householdId,
            recipientId: fixture.recipientId,
            type: 'ROUTINE_CONFIRMED',
            severity: 'INFO',
            sourceType: 'FAMILY',
            titleCiphertext: new Uint8Array(content.ciphertext),
            summaryCiphertext: new Uint8Array(),
            contentNonce: new Uint8Array(content.nonce),
            encryptionKeyId: content.encryptionKeyId,
            dedupeKey: `history-${id}`,
            occurredAt: new Date(
              index < 65
                ? '2026-08-31T16:00:00Z'
                : index === 65
                  ? '2026-08-31T15:59:59.999Z'
                  : '2026-09-01T16:00:00Z',
            ),
          },
        });
      }
      oldOccurrenceId = ulid();
      await fixture.db.routineOccurrence.create({
        data: {
          id: oldOccurrenceId,
          householdId: fixture.householdId,
          recipientId: fixture.recipientId,
          routineId: fixture.review.routineId,
          scheduleId: fixture.review.scheduleId,
          status: 'NEEDS_FAMILY_REVIEW',
          scheduledAtUtc: new Date('2026-08-31T16:00:00Z'),
          scheduledLocalDate: new Date('2026-09-01T00:00:00Z'),
        },
      });
    }, 30_000);
    afterAll(async () => {
      if (fixture) await fixture.cleanup();
    }, 30_000);

    it('reaches all 65 date-filtered records through three real SQL pages without duplicates', async () => {
      let cursor: string | null = null;
      const ids: string[] = [];
      const sizes: number[] = [];
      for (let page = 0; page < 3; page++) {
        const result = await read('events', {
          ...dates,
          ...(cursor ? { cursor } : {}),
        })
          .expect(200)
          .expect('Cache-Control', 'no-store');
        const data = result.body.data as {
          items: Array<{ id: string; title: string }>;
          nextCursor: string | null;
        };
        ids.push(...data.items.map((item) => item.id));
        sizes.push(data.items.length);
        expect(data.items[0].title).toMatch(/^历史记录 /);
        cursor = data.nextCursor;
        if (page < 2) expect(cursor).not.toBeNull();
      }
      expect(sizes).toEqual([30, 30, 5]);
      expect(cursor).toBeNull();
      expect(ids).toEqual([...eventIds].sort().reverse());
      expect(new Set(ids).size).toBe(65);
    });

    it('can find an old reminder by current status without losing the default future reminders', async () => {
      const history = (
        await read('occurrences', {
          ...dates,
          status: 'NEEDS_FAMILY_REVIEW',
        }).expect(200)
      ).body.data;
      expect(history.items.map((item: { id: string }) => item.id)).toEqual([
        oldOccurrenceId,
      ]);
      expect(history.items[0]).toMatchObject({
        routineTitle: '早餐后饮水',
        contentProvenance: 'FAMILY_ENTERED_VERBATIM',
      });
      expect(
        (
          await read('occurrences', { ...dates, status: 'CONFIRMED' }).expect(
            200,
          )
        ).body.data.items,
      ).toEqual([]);
      const recent = (await read('occurrences').expect(200)).body.data
        .items as Array<{ id: string; routineTitle: string }>;
      expect(recent.some((item) => item.id === oldOccurrenceId)).toBe(false);
      expect(
        recent.some((item) => item.routineTitle === '明日提醒-不应计入'),
      ).toBe(true);
    });

    it('rejects anonymous, outsider, wrong-recipient scope and ungranted recipient access', async () => {
      await request(fixture.app.getHttpServer())
        .get(path('events'))
        .expect(401);
      await read('events', {}, fixture.outsider.session.accessToken).expect(
        403,
      );
      await read(
        'events',
        {},
        fixture.owner.session.accessToken,
        fixture.otherRecipientId,
      ).expect(403);
      await read(
        'events',
        {},
        fixture.caregiver.session.accessToken,
        fixture.emptyRecipientId,
      ).expect(403);
      expect(
        (
          await read(
            'events',
            {},
            fixture.owner.session.accessToken,
            fixture.emptyRecipientId,
          ).expect(200)
        ).body.data.items,
      ).toEqual([]);
    });

    it('rejects malformed queries and a cursor reused for another date, recipient or page size', async () => {
      for (const query of [
        { startDate: '2026-09-01' },
        { startDate: '2026-02-30', endDate: '2026-03-01' },
        { startDate: '2026-09-01', endDate: '2026-10-02' },
        { limit: 51 },
        { limit: 'abc' },
        { status: 'CONFIRMED' },
        { cursor: 'invalid' },
      ])
        await read('events', query).expect(400);
      const cursor = (await read('events', dates).expect(200)).body.data
        .nextCursor as string;
      await read('events', { ...dates, cursor, endDate: '2026-09-02' }).expect(
        400,
      );
      await read('events', { ...dates, cursor, limit: 20 }).expect(400);
      await read(
        'events',
        { ...dates, cursor },
        fixture.owner.session.accessToken,
        fixture.emptyRecipientId,
      ).expect(400);
      await read('occurrences', { status: 'UNKNOWN' }).expect(400);
    });

    it('reauthorizes later pages when a caregiver loses event access', async () => {
      const token = fixture.caregiver.session.accessToken;
      const cursor = (await read('events', dates, token).expect(200)).body.data
        .nextCursor as string;
      await fixture.db.recipientMember.update({
        where: { id: fixture.authorityId },
        data: { canViewEvents: false },
      });
      try {
        await read('events', { ...dates, cursor }, token).expect(403);
      } finally {
        await fixture.db.recipientMember.update({
          where: { id: fixture.authorityId },
          data: { canViewEvents: true },
        });
      }
    });

    it('keeps both legacy array contracts intact', async () => {
      for (const kind of ['events', 'occurrences']) {
        const result = await request(fixture.app.getHttpServer())
          .get(path(kind).replace('/history', ''))
          .auth(fixture.owner.session.accessToken, { type: 'bearer' })
          .expect(200);
        expect(Array.isArray(result.body.data)).toBe(true);
        expect(result.body.data.length).toBeGreaterThan(0);
      }
    });
  },
);
