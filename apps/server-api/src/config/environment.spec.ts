import { describe, expect, it } from '@jest/globals';
import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  it('provides safe development defaults', () => {
    expect(validateEnvironment({})).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      CORS_ORIGINS: 'http://127.0.0.1:4310,http://localhost:4310',
    });
  });

  it('coerces a valid port', () => {
    expect(validateEnvironment({ PORT: '3100' }).PORT).toBe(3100);
  });

  it('rejects an arbitrary public bind host', () => {
    expect(() => validateEnvironment({ HOST: '192.0.2.20' })).toThrow(
      'Invalid environment',
    );
  });

  it('rejects invalid ports', () => {
    expect(() => validateEnvironment({ PORT: '70000' })).toThrow(
      'Invalid environment',
    );
  });

  it('rejects a wildcard CORS origin when credentials are enabled', () => {
    expect(() => validateEnvironment({ CORS_ORIGINS: '*' })).toThrow(
      'CORS_ORIGINS cannot contain *',
    );
  });

  it('rejects malformed CORS origins', () => {
    expect(() =>
      validateEnvironment({ CORS_ORIGINS: 'https://example.com,not-a-url' }),
    ).toThrow('CORS_ORIGINS must contain only HTTP(S) origins');
  });
});
