import { ConfigService } from '@nestjs/config';

import { DEFAULT_INVITATION_TTL_SECONDS } from '../household.constants';

export interface HouseholdSecurityConfig {
  environment: 'development' | 'test' | 'production';
  invitationTokenPepper: Buffer;
  invitationTtlSeconds: number;
}

const DEVELOPMENT_INVITATION_PEPPER =
  'development-only-household-invitation-pepper-change-2026';

export function createHouseholdSecurityConfig(
  config: ConfigService,
): HouseholdSecurityConfig {
  const environment = config.get<'development' | 'test' | 'production'>(
    'NODE_ENV',
    'development',
  );
  const rawPepper =
    config.get<string>('HOUSEHOLD_INVITATION_TOKEN_PEPPER') ??
    (environment === 'production' ? undefined : DEVELOPMENT_INVITATION_PEPPER);

  if (!rawPepper || Buffer.byteLength(rawPepper, 'utf8') < 32) {
    throw new Error(
      'HOUSEHOLD_INVITATION_TOKEN_PEPPER must contain at least 32 bytes',
    );
  }

  const rawTtl = config.get<string | number>(
    'HOUSEHOLD_INVITATION_TTL_SECONDS',
    DEFAULT_INVITATION_TTL_SECONDS,
  );
  const invitationTtlSeconds = Number(rawTtl);
  if (
    !Number.isInteger(invitationTtlSeconds) ||
    invitationTtlSeconds < 15 * 60 ||
    invitationTtlSeconds > 7 * 24 * 60 * 60
  ) {
    throw new Error(
      'HOUSEHOLD_INVITATION_TTL_SECONDS must be between 900 and 604800',
    );
  }

  return {
    environment,
    invitationTokenPepper: Buffer.from(rawPepper, 'utf8'),
    invitationTtlSeconds,
  };
}
