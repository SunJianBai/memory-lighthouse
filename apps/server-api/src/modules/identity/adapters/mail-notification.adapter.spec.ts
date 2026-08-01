import { describe, expect, it } from '@jest/globals';

import { InMemoryMailDeliveryAdapter } from '../../../infrastructure/mail/adapters/in-memory-mail-delivery.adapter';
import type { MailDeliveryConfig } from '../../../infrastructure/mail';
import { MailNotificationAdapter } from './mail-notification.adapter';

const config: MailDeliveryConfig = {
  environment: 'test',
  mode: 'memory',
  publicAppUrl: 'https://sun227454.online/',
  fromName: '守忆灯塔',
  fromAddress: 'no-reply@example.com',
};

describe('MailNotificationAdapter', () => {
  it('renders an encoded /openBMB email-verification link', async () => {
    const delivery = new InMemoryMailDeliveryAdapter(config);
    const adapter = new MailNotificationAdapter(delivery, config);

    await adapter.sendEmailVerification({
      email: 'family@example.com',
      token: 'raw+token/&?',
      expiresAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const [mail] = delivery.drainForTesting();
    expect(mail).toMatchObject({
      category: 'EMAIL_VERIFICATION',
      to: 'family@example.com',
      subject: '守忆灯塔邮箱验证',
    });
    expect(mail.text).toContain(
      'https://sun227454.online/openBMB/auth/verify-email#',
    );
    expect(
      new URLSearchParams(
        new URL(mail.text.match(/https:\/\/\S+/)?.[0] ?? '').hash.slice(1),
      ).get('token'),
    ).toBe('raw+token/&?');
    expect(mail.html).toContain('/openBMB/auth/verify-email#');
    expect(mail.html).toContain('%26');
  });

  it('renders password-reset links on a distinct public route', async () => {
    const delivery = new InMemoryMailDeliveryAdapter(config);
    const adapter = new MailNotificationAdapter(delivery, config);

    await adapter.sendPasswordReset({
      email: 'family@example.com',
      token: 'opaque-reset-token',
      expiresAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const [mail] = delivery.drainForTesting();
    expect(mail.category).toBe('PASSWORD_RESET');
    expect(mail.text).toContain('/openBMB/auth/reset-password#');
  });
});
