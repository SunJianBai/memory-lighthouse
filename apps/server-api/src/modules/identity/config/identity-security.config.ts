import { ConfigService } from '@nestjs/config';

import {
  USER_ACCESS_TOKEN_AUDIENCE,
  USER_ACCESS_TOKEN_ISSUER,
} from '../identity.constants';

export interface IdentitySecurityConfig {
  environment: 'development' | 'test' | 'production';
  accessTokenSecret: Buffer;
  refreshTokenPepper: Buffer;
  oneTimeTokenPepper: Buffer;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  emailVerificationTtlSeconds: number;
  passwordResetTtlSeconds: number;
  accessTokenIssuer: string;
  accessTokenAudience: string;
  refreshCookieName: string;
  refreshCookiePath: string;
  secureCookies: boolean;
}

const DEVELOPMENT_ACCESS_SECRET =
  'development-only-access-secret-change-before-production-2026';
const DEVELOPMENT_REFRESH_PEPPER =
  'development-only-refresh-pepper-change-before-production-2026';
const DEVELOPMENT_ONE_TIME_PEPPER =
  'development-only-one-time-pepper-change-before-production-2026';

function seconds(
  config: ConfigService,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = config.get<string | number>(name);
  const value = raw === undefined ? fallback : Number(raw);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return value;
}

function secret(
  config: ConfigService,
  name: string,
  environment: string,
  developmentFallback: string,
): Buffer {
  const value =
    config.get<string>(name) ??
    (environment === 'production' ? undefined : developmentFallback);

  if (!value || Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }

  return Buffer.from(value, 'utf8');
}

export function createIdentitySecurityConfig(
  config: ConfigService,
): IdentitySecurityConfig {
  const environment = config.get<'development' | 'test' | 'production'>(
    'NODE_ENV',
    'development',
  );

  return {
    environment,
    accessTokenSecret: secret(
      config,
      'AUTH_ACCESS_TOKEN_SECRET',
      environment,
      DEVELOPMENT_ACCESS_SECRET,
    ),
    refreshTokenPepper: secret(
      config,
      'AUTH_REFRESH_TOKEN_PEPPER',
      environment,
      DEVELOPMENT_REFRESH_PEPPER,
    ),
    oneTimeTokenPepper: secret(
      config,
      'AUTH_ONE_TIME_TOKEN_PEPPER',
      environment,
      DEVELOPMENT_ONE_TIME_PEPPER,
    ),
    accessTokenTtlSeconds: seconds(
      config,
      'AUTH_ACCESS_TOKEN_TTL_SECONDS',
      15 * 60,
      5 * 60,
      15 * 60,
    ),
    refreshTokenTtlSeconds: seconds(
      config,
      'AUTH_REFRESH_TOKEN_TTL_SECONDS',
      30 * 24 * 60 * 60,
      24 * 60 * 60,
      30 * 24 * 60 * 60,
    ),
    emailVerificationTtlSeconds: seconds(
      config,
      'AUTH_EMAIL_VERIFICATION_TTL_SECONDS',
      24 * 60 * 60,
      15 * 60,
      48 * 60 * 60,
    ),
    passwordResetTtlSeconds: seconds(
      config,
      'AUTH_PASSWORD_RESET_TTL_SECONDS',
      30 * 60,
      5 * 60,
      2 * 60 * 60,
    ),
    accessTokenIssuer: USER_ACCESS_TOKEN_ISSUER,
    accessTokenAudience: USER_ACCESS_TOKEN_AUDIENCE,
    refreshCookieName: 'ml_user_refresh',
    refreshCookiePath: '/openBMB/api/v1/auth',
    secureCookies: environment === 'production',
  };
}
