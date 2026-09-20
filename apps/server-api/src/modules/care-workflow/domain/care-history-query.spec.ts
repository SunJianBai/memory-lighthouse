import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AesGcmContentCipherAdapter } from '../adapters/aes-gcm-content-cipher.adapter';
import {
  careHistoryWindow,
  type CareHistoryKind,
  type CareHistoryQuery,
} from './care-history-query';

const cipher = new AesGcmContentCipherAdapter(
  new ConfigService({ NODE_ENV: 'test' }),
);
const now = new Date('2026-09-20T04:00:00.000Z');
const rowId = '01M2Z3DYHZFEF2V6NSCWSTS69X';
const window = (
  query: CareHistoryQuery = {},
  kind: CareHistoryKind = 'occurrences',
  timezone = 'Asia/Shanghai',
) => careHistoryWindow(kind, 'home', 'recipient', timezone, query, now, cipher);

describe('care history dates and authenticated cursors', () => {
  it('preserves the rolling reminder default and bounded-page latest-events default', () => {
    expect(window()).toMatchObject({
      limit: 30,
      from: new Date('2026-09-19T04:00:00Z'),
      to: new Date('2026-09-27T04:00:00Z'),
      after: null,
    });
    expect(window({}, 'events')).toMatchObject({
      limit: 30,
      from: null,
      to: null,
    });
  });

  it.each([
    [
      'Asia/Shanghai',
      '2026-09-01',
      '2026-09-01',
      '2026-08-31T16:00:00.000Z',
      '2026-09-01T16:00:00.000Z',
    ],
    [
      'America/Los_Angeles',
      '2026-03-08',
      '2026-03-08',
      '2026-03-08T08:00:00.000Z',
      '2026-03-09T07:00:00.000Z',
    ],
    [
      'America/Los_Angeles',
      '2026-11-01',
      '2026-11-01',
      '2026-11-01T07:00:00.000Z',
      '2026-11-02T08:00:00.000Z',
    ],
    [
      'Asia/Shanghai',
      '2025-12-30',
      '2026-01-02',
      '2025-12-29T16:00:00.000Z',
      '2026-01-02T16:00:00.000Z',
    ],
    [
      'UTC',
      '2024-02-29',
      '2024-02-29',
      '2024-02-29T00:00:00.000Z',
      '2024-03-01T00:00:00.000Z',
    ],
    [
      'Pacific/Apia',
      '2011-12-30',
      '2011-12-30',
      '2011-12-30T10:00:00.000Z',
      '2011-12-30T10:00:00.000Z',
    ],
    [
      'America/Sao_Paulo',
      '2018-11-04',
      '2018-11-04',
      '2018-11-04T03:00:00.000Z',
      '2018-11-05T02:00:00.000Z',
    ],
  ])('resolves %s %s through %s', (zone, startDate, endDate, from, to) => {
    const result = window({ startDate, endDate }, 'events', zone);
    expect(result.from?.toISOString()).toBe(from);
    expect(result.to?.toISOString()).toBe(to);
  });

  it('allows a full old month but not more than 31 inclusive calendar days', () => {
    expect(
      window({ startDate: '2020-01-01', endDate: '2020-01-31' }).from,
    ).toEqual(new Date('2019-12-31T16:00:00Z'));
    expect(() =>
      window({ startDate: '2020-01-01', endDate: '2020-02-01' }),
    ).toThrow(BadRequestException);
  });

  it.each<CareHistoryQuery>([
    { startDate: '2026-09-01' },
    { endDate: '2026-09-01' },
    { startDate: '2026-02-30', endDate: '2026-03-01' },
    { startDate: '2026-9-1', endDate: '2026-09-01' },
    { startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-01' },
    { startDate: '2026-09-02', endDate: '2026-09-01' },
    { startDate: '1899-12-31', endDate: '1900-01-01' },
    { startDate: '9999-01-01', endDate: '9999-01-01' },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { limit: NaN },
    { status: '' },
    { status: 'UNKNOWN' },
    { cursor: '' },
    { cursor: '*' },
    { cursor: 'a'.repeat(4097) },
  ])('rejects invalid query %j', (query) => {
    expect(() => window(query)).toThrow(BadRequestException);
  });

  it('does not accept event status filters or invalid profile zones', () => {
    expect(() => window({ status: 'CONFIRMED' }, 'events')).toThrow(
      BadRequestException,
    );
    expect(() => window({}, 'events', 'Invalid/Zone')).toThrow(
      BadRequestException,
    );
  });

  it('pins the first page window even when the clock advances', () => {
    const first = window();
    const cursor = first.nextCursor(now, rowId);
    const next = careHistoryWindow(
      'occurrences',
      'home',
      'recipient',
      'Asia/Shanghai',
      { cursor },
      new Date('2026-09-22T04:00:00Z'),
      cipher,
    );
    expect(next).toMatchObject({
      from: first.from,
      to: first.to,
      after: { at: now, id: rowId },
    });
    expect(Buffer.from(cursor, 'base64url').toString()).not.toContain(rowId);
  });

  it('binds household, recipient, kind, timezone and every applied query field', () => {
    const query = {
      startDate: '2026-09-01',
      endDate: '2026-09-20',
      status: 'CONFIRMED',
      limit: 20,
    };
    const cursor = window(query).nextCursor(now, rowId);
    for (const changed of [
      { ...query, startDate: '2026-09-02' },
      { ...query, endDate: '2026-09-21' },
      { ...query, status: 'EXPIRED' },
      { ...query, limit: 30 },
      {},
    ])
      expect(() => window({ ...changed, cursor })).toThrow(BadRequestException);
    for (const [home, recipient, zone] of [
      ['other', 'recipient', 'Asia/Shanghai'],
      ['home', 'other', 'Asia/Shanghai'],
      ['home', 'recipient', 'America/Los_Angeles'],
    ])
      expect(() =>
        careHistoryWindow(
          'occurrences',
          home,
          recipient,
          zone,
          { ...query, cursor },
          now,
          cipher,
        ),
      ).toThrow(BadRequestException);
    const unfilteredCursor = window().nextCursor(now, rowId);
    expect(() => window({ cursor: unfilteredCursor }, 'events')).toThrow(
      BadRequestException,
    );
  });

  it('rejects actual AES-GCM tampering and foreign encrypted payloads', () => {
    const cursor = window().nextCursor(now, rowId);
    const envelope = JSON.parse(
      Buffer.from(cursor, 'base64url').toString(),
    ) as string[];
    const ciphertext = Buffer.from(envelope[2], 'base64url');
    ciphertext[0] ^= 1;
    envelope[2] = ciphertext.toString('base64url');
    expect(() =>
      window({
        cursor: Buffer.from(JSON.stringify(envelope)).toString('base64url'),
      }),
    ).toThrow(BadRequestException);
    const unrelated = cipher.encrypt(
      JSON.stringify(['family text', 'not a cursor']),
    );
    const unrelatedCursor = Buffer.from(
      JSON.stringify([
        unrelated.encryptionKeyId,
        unrelated.nonce.toString('base64url'),
        unrelated.ciphertext.toString('base64url'),
      ]),
    ).toString('base64url');
    expect(() => window({ cursor: unrelatedCursor })).toThrow(
      BadRequestException,
    );
  });
});
