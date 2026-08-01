import { describe, expect, it } from '@jest/globals';

import { DATABASE_URL_ENV_NAME, requireDatabaseUrl } from './database-url';

describe('requireDatabaseUrl', () => {
  it('returns a valid MySQL connection URL unchanged', () => {
    const databaseUrl =
      'mysql://openbmb:p%40ssword@mysql:3306/openbmb?connection_limit=5';

    expect(requireDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(databaseUrl);
  });

  it('trims harmless surrounding whitespace', () => {
    expect(
      requireDatabaseUrl({
        DATABASE_URL: '  mysql://openbmb:secret@mysql:3306/openbmb  ',
      }),
    ).toBe('mysql://openbmb:secret@mysql:3306/openbmb');
  });

  it.each([
    [{}, `${DATABASE_URL_ENV_NAME} is required`],
    [
      { DATABASE_URL: 'not-a-url' },
      `${DATABASE_URL_ENV_NAME} must be a valid MySQL URL`,
    ],
    [
      { DATABASE_URL: 'postgresql://openbmb:secret@db:5432/openbmb' },
      `${DATABASE_URL_ENV_NAME} must use the mysql protocol`,
    ],
    [
      { DATABASE_URL: 'mysql://openbmb:secret@mysql:3306' },
      `${DATABASE_URL_ENV_NAME} must include a database name`,
    ],
  ])('rejects unsafe or incomplete configuration', (environment, message) => {
    expect(() => requireDatabaseUrl(environment)).toThrow(message);
  });

  it('does not include the supplied credential in validation errors', () => {
    const secret = 'do-not-log-this-password';

    expect(() =>
      requireDatabaseUrl({
        DATABASE_URL: `https://openbmb:${secret}@mysql/openbmb`,
      }),
    ).toThrow(DATABASE_URL_ENV_NAME);

    try {
      requireDatabaseUrl({
        DATABASE_URL: `https://openbmb:${secret}@mysql/openbmb`,
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
