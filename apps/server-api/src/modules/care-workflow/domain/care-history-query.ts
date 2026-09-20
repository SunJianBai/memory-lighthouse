import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { OCCURRENCE_STATUS } from '../care-workflow.constants';
import type { CareWorkflowContentCipher } from '../ports/content-cipher.port';
import { localDateRangeWindow } from './local-day-window';

export type CareHistoryKind = 'occurrences' | 'events';
export interface CareHistoryQuery {
  startDate?: string;
  endDate?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

interface HistoryCursor {
  purpose: 'care-history-v1';
  scope: string;
  from: string | null;
  to: string | null;
  at: string;
  id: string;
}

const DAY = 86_400_000;
const badCursor = () => new BadRequestException('记录分页已失效，请重新查询');
const strictInstant = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

function calendarDate(value: string): number {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value ||
    value < '1900-01-01' ||
    value > '9998-12-31'
  ) {
    throw new BadRequestException(
      '请输入 1900–9998 年内的有效日期（YYYY-MM-DD）',
    );
  }
  return time;
}

function decodeCursor(
  cipher: CareWorkflowContentCipher,
  cursor: string,
): HistoryCursor {
  try {
    if (!cursor || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw badCursor();
    const envelope: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(envelope) ||
      envelope.length !== 3 ||
      !envelope.every((part) => typeof part === 'string')
    )
      throw badCursor();
    const [encryptionKeyId, nonce, ciphertext] = envelope;
    const value: unknown = JSON.parse(
      cipher.decrypt({
        encryptionKeyId,
        nonce: Buffer.from(nonce, 'base64url'),
        ciphertext: Buffer.from(ciphertext, 'base64url'),
      }),
    );
    if (!value || typeof value !== 'object') throw badCursor();
    const parsed = value as Record<string, unknown>;
    if (
      parsed.purpose !== 'care-history-v1' ||
      typeof parsed.scope !== 'string' ||
      !strictInstant(parsed.at) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(parsed.id) ||
      !(parsed.from === null || strictInstant(parsed.from)) ||
      !(parsed.to === null || strictInstant(parsed.to)) ||
      (parsed.from === null) !== (parsed.to === null)
    )
      throw badCursor();
    return parsed as unknown as HistoryCursor;
  } catch {
    throw badCursor();
  }
}

/** Resolves filters once; authenticated cursors pin the first page's rolling window. */
export function careHistoryWindow(
  kind: CareHistoryKind,
  householdId: string,
  recipientId: string,
  timezone: string,
  query: CareHistoryQuery,
  now: Date,
  cipher: CareWorkflowContentCipher,
) {
  const limit = query.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new BadRequestException('每页记录数必须为 1–50');
  }
  if (
    query.status !== undefined &&
    (kind !== 'occurrences' ||
      !Object.values(OCCURRENCE_STATUS).some(
        (status) => status === query.status,
      ))
  ) {
    throw new BadRequestException('提醒状态无效');
  }
  if ((query.startDate === undefined) !== (query.endDate === undefined)) {
    throw new BadRequestException('请同时填写开始日期和结束日期');
  }
  let range: { from: Date; to: Date } | null = null;
  if (query.startDate !== undefined && query.endDate !== undefined) {
    const days =
      (calendarDate(query.endDate) - calendarDate(query.startDate)) / DAY + 1;
    if (days < 1 || days > 31)
      throw new BadRequestException('日期范围须按先后顺序选择，且不超过 31 天');
  }
  try {
    // Validate even the default view: an invalid profile zone must not silently become device-local.
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now);
    if (query.startDate !== undefined && query.endDate !== undefined) {
      range = localDateRangeWindow(query.startDate, query.endDate, timezone);
    } else if (kind === 'occurrences') {
      range = {
        from: new Date(now.getTime() - DAY),
        to: new Date(now.getTime() + 7 * DAY),
      };
    }
  } catch {
    throw new BadRequestException('长者档案时区无效，请先更新时区');
  }
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        kind,
        householdId,
        recipientId,
        timezone,
        query.startDate ?? null,
        query.endDate ?? null,
        query.status ?? null,
        limit,
      ]),
    )
    .digest('hex');
  const cursor =
    query.cursor === undefined ? null : decodeCursor(cipher, query.cursor);
  if (cursor && cursor.scope !== scope) throw badCursor();
  const from = cursor ? cursor.from : (range?.from.toISOString() ?? null);
  const to = cursor ? cursor.to : (range?.to.toISOString() ?? null);
  return {
    limit,
    from: from ? new Date(from) : null,
    to: to ? new Date(to) : null,
    after: cursor ? { at: new Date(cursor.at), id: cursor.id } : null,
    nextCursor(at: Date, id: string) {
      const encrypted = cipher.encrypt(
        JSON.stringify({
          purpose: 'care-history-v1',
          scope,
          from,
          to,
          at: at.toISOString(),
          id,
        } satisfies HistoryCursor),
      );
      return Buffer.from(
        JSON.stringify([
          encrypted.encryptionKeyId,
          encrypted.nonce.toString('base64url'),
          encrypted.ciphertext.toString('base64url'),
        ]),
      ).toString('base64url');
    },
  };
}
