import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { createMailDeliveryConfig } from './mail.config';

function create(values: Record<string, unknown>) {
  return createMailDeliveryConfig(new ConfigService(values));
}

const productionValues = {
  NODE_ENV: 'production',
  MAIL_DELIVERY_MODE: 'smtp',
  PUBLIC_APP_URL: 'https://sun227454.online',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_REQUIRE_TLS: 'true',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'not-a-real-password',
  SMTP_FROM_NAME: '守忆灯塔',
  SMTP_FROM_ADDRESS: 'no-reply@example.com',
} as const;

describe('createMailDeliveryConfig', () => {
  it('uses a non-delivering memory outbox only outside production', () => {
    expect(create({ NODE_ENV: 'test' })).toMatchObject({
      environment: 'test',
      mode: 'memory',
      publicAppUrl: 'http://127.0.0.1:4310/',
      fromAddress: 'no-reply@localhost.invalid',
    });
  });

  it('requires real SMTP configuration in production', () => {
    expect(() => create({ ...productionValues, SMTP_HOST: undefined })).toThrow(
      'SMTP_HOST',
    );
    expect(() =>
      create({ ...productionValues, SMTP_PASSWORD: undefined }),
    ).toThrow('SMTP_USER and SMTP_PASSWORD must be configured together');
    expect(() =>
      create({ ...productionValues, MAIL_DELIVERY_MODE: 'memory' }),
    ).toThrow('MAIL_DELIVERY_MODE must be smtp in production');
  });

  it('requires HTTPS links and TLS-protected SMTP in production', () => {
    expect(() =>
      create({ ...productionValues, PUBLIC_APP_URL: 'http://example.com' }),
    ).toThrow('PUBLIC_APP_URL must use HTTPS in production');
    expect(() =>
      create({ ...productionValues, SMTP_REQUIRE_TLS: 'false' }),
    ).toThrow('SMTP transport must require TLS in production');
  });

  it('accepts QQ SMTP over implicit TLS without requesting STARTTLS', () => {
    const config = create({
      ...productionValues,
      SMTP_HOST: 'smtp.qq.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_REQUIRE_TLS: 'false',
      SMTP_USER: '123456@qq.com',
      SMTP_FROM_ADDRESS: '123456@qq.com',
    });

    expect(config.smtp).toMatchObject({
      host: 'smtp.qq.com',
      port: 465,
      secure: true,
      requireTls: false,
      username: '123456@qq.com',
    });
  });

  it('preserves SMTP password bytes instead of trimming the secret', () => {
    const config = create({
      ...productionValues,
      SMTP_PASSWORD: ' password-with-significant-spaces ',
    });

    expect(config.smtp?.password).toBe(' password-with-significant-spaces ');
  });
});
