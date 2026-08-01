import { ConfigService } from '@nestjs/config';

import type { MailDeliveryConfig, MailDeliveryMode } from './mail.types';
import { isSafeEmailAddress } from './mail-content';

const DEFAULT_DEVELOPMENT_APP_URL = 'http://127.0.0.1:4310';
const DEFAULT_FROM_NAME = '守忆灯塔';

function readOptional(config: ConfigService, key: string): string | undefined {
  const value = config.get<string | number | boolean>(key);
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized === '' ? undefined : normalized;
}

function readOptionalSecret(
  config: ConfigService,
  key: string,
): string | undefined {
  const value = config.get<string>(key);
  return value === undefined || value.length === 0 ? undefined : value;
}

function readInteger(
  config: ConfigService,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = readOptional(config, key);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${key} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function readBoolean(
  config: ConfigService,
  key: string,
  fallback: boolean,
): boolean {
  const raw = readOptional(config, key)?.toLowerCase();
  if (raw === undefined) {
    return fallback;
  }
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }
  throw new Error(`${key} must be true, false, 1, or 0`);
}

function readMode(
  config: ConfigService,
  environment: MailDeliveryConfig['environment'],
): MailDeliveryMode {
  const raw = readOptional(config, 'MAIL_DELIVERY_MODE')?.toLowerCase();
  const mode = raw ?? (environment === 'production' ? 'smtp' : 'memory');
  if (mode !== 'memory' && mode !== 'smtp') {
    throw new Error('MAIL_DELIVERY_MODE must be memory or smtp');
  }
  if (environment === 'production' && mode !== 'smtp') {
    throw new Error('MAIL_DELIVERY_MODE must be smtp in production');
  }
  return mode;
}

function readPublicAppUrl(
  config: ConfigService,
  environment: MailDeliveryConfig['environment'],
): string {
  const raw =
    readOptional(config, 'PUBLIC_APP_URL') ??
    (environment === 'production' ? undefined : DEFAULT_DEVELOPMENT_APP_URL);
  if (!raw) {
    throw new Error('PUBLIC_APP_URL is required in production');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('PUBLIC_APP_URL must be a valid HTTP(S) URL');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'PUBLIC_APP_URL must be an HTTP(S) URL without credentials, query, or fragment',
    );
  }
  if (environment === 'production' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_URL must use HTTPS in production');
  }

  return url.toString();
}

function readHeaderSafeValue(
  config: ConfigService,
  key: string,
  fallback?: string,
): string {
  const value = readOptional(config, key) ?? fallback;
  if (!value || value.length > 200 || /[\r\n\0]/.test(value)) {
    throw new Error(`${key} must be a non-empty header-safe value`);
  }
  return value.normalize('NFKC');
}

export function createMailDeliveryConfig(
  config: ConfigService,
): MailDeliveryConfig {
  const environment = config.get<MailDeliveryConfig['environment']>(
    'NODE_ENV',
    'development',
  );
  const mode = readMode(config, environment);
  const fromName = readHeaderSafeValue(
    config,
    'SMTP_FROM_NAME',
    DEFAULT_FROM_NAME,
  );
  const fromAddress =
    readOptional(config, 'SMTP_FROM_ADDRESS') ??
    (environment === 'production' ? undefined : 'no-reply@localhost.invalid');

  if (!fromAddress || !isSafeEmailAddress(fromAddress)) {
    throw new Error('SMTP_FROM_ADDRESS must be a valid email address');
  }

  const result: MailDeliveryConfig = {
    environment,
    mode,
    publicAppUrl: readPublicAppUrl(config, environment),
    fromName,
    fromAddress,
  };

  if (mode === 'memory') {
    return result;
  }

  const host = readHeaderSafeValue(config, 'SMTP_HOST');
  if (/\s/.test(host) || host.length > 253) {
    throw new Error('SMTP_HOST must be a valid hostname or IP address');
  }
  const username = readOptional(config, 'SMTP_USER');
  const password = readOptionalSecret(config, 'SMTP_PASSWORD');
  if ((username === undefined) !== (password === undefined)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
  }
  if (environment === 'production' && (!username || !password)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD are required in production');
  }

  const secure = readBoolean(config, 'SMTP_SECURE', false);
  const requireTls = readBoolean(
    config,
    'SMTP_REQUIRE_TLS',
    environment === 'production' && !secure,
  );
  if (environment === 'production' && !secure && !requireTls) {
    throw new Error('SMTP transport must require TLS in production');
  }

  result.smtp = {
    host,
    port: readInteger(config, 'SMTP_PORT', secure ? 465 : 587, 1, 65_535),
    secure,
    requireTls,
    username: username ?? '',
    password: password ?? '',
    connectionTimeoutMs: readInteger(
      config,
      'SMTP_CONNECTION_TIMEOUT_MS',
      10_000,
      1_000,
      120_000,
    ),
    greetingTimeoutMs: readInteger(
      config,
      'SMTP_GREETING_TIMEOUT_MS',
      10_000,
      1_000,
      120_000,
    ),
    socketTimeoutMs: readInteger(
      config,
      'SMTP_SOCKET_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
  };

  return result;
}
