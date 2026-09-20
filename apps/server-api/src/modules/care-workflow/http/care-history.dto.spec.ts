import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import { CareHistoryController } from './care-history.controller';
import {
  CareHistoryQueryDto,
  OccurrenceHistoryQueryDto,
} from './care-history.dto';

const pipe = new ValidationPipe({
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
  transformOptions: { enableImplicitConversion: false },
});
const validate = (value: object, metatype = CareHistoryQueryDto) =>
  pipe.transform(value, { type: 'query', metatype });

describe('history route query boundary', () => {
  it('allows bounded queries, transforms limit, and inherits the shared date fields', async () => {
    await expect(
      validate(
        {
          startDate: '2026-09-01',
          endDate: '2026-09-20',
          limit: '30',
          status: 'EXPIRED',
        },
        OccurrenceHistoryQueryDto,
      ),
    ).resolves.toMatchObject({ limit: 30, status: 'EXPIRED' });
    await expect(validate({})).resolves.toEqual({});
  });
  it.each([
    { limit: '0' },
    { limit: '51' },
    { limit: '2.5' },
    { limit: 'abc' },
    { limit: ['1', '2'] },
    { cursor: ['a', 'b'] },
    { cursor: 'a'.repeat(4097) },
    { startDate: ['2026-09-01', '2026-09-02'] },
    { startDate: '2026-9-1' },
    { status: 'CONFIRMED' },
    { search: 'test' },
    { cursor: '' },
  ])('rejects malformed or unrecognized event query %j', async (query) => {
    await expect(validate(query)).rejects.toThrow(BadRequestException);
  });
  it('does not accept unknown reminder statuses', async () => {
    await expect(
      validate({ status: 'UNKNOWN' }, OccurrenceHistoryQueryDto),
    ).rejects.toThrow(BadRequestException);
  });
  it('registers both new routes under the existing user authentication guard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CareHistoryController),
    ).toContain(UserAccessGuard);
    expect(Reflect.getMetadata(PATH_METADATA, CareHistoryController)).toBe(
      'households/:householdId/care-recipients/:recipientId',
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        // Metadata inspection requires the unbound handler, never invoking it.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        CareHistoryController.prototype.occurrences,
      ),
    ).toBe('occurrences/history');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        CareHistoryController.prototype.events,
      ),
    ).toBe('events/history');
  });
});
