import { describe, expect, it, jest } from '@jest/globals';

import type { MailDeliveryConfig, OutboundMailMessage } from '../mail.types';
import { SmtpMailDeliveryAdapter } from './smtp-mail-delivery.adapter';

const config: MailDeliveryConfig = {
  environment: 'production',
  mode: 'smtp',
  publicAppUrl: 'https://sun227454.online/',
  fromName: '守忆灯塔',
  fromAddress: 'no-reply@example.com',
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    requireTls: true,
    username: 'mailer',
    password: 'not-a-real-password',
    connectionTimeoutMs: 10_000,
    greetingTimeoutMs: 10_000,
    socketTimeoutMs: 30_000,
  },
};

const message: OutboundMailMessage = {
  category: 'EMAIL_VERIFICATION',
  to: 'family@example.com',
  subject: '守忆灯塔邮箱验证',
  text: 'https://example.com/token',
  html: '<a href="https://example.com/token">verify</a>',
};

function makeTransporter() {
  return {
    verify: jest.fn<() => Promise<true>>().mockResolvedValue(true),
    sendMail: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    close: jest.fn<() => void>(),
  };
}

describe('SmtpMailDeliveryAdapter', () => {
  it('verifies SMTP during startup and sends using address objects', async () => {
    const transporter = makeTransporter();
    const adapter = new SmtpMailDeliveryAdapter(config, transporter);

    await expect(adapter.onModuleInit()).resolves.toBeUndefined();
    await expect(adapter.send(message)).resolves.toBeUndefined();

    expect(transporter.verify).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: '守忆灯塔', address: 'no-reply@example.com' },
        to: [{ address: 'family@example.com', name: '' }],
        subject: '守忆灯塔邮箱验证',
      }),
    );
    expect(adapter.readiness()).toEqual({ status: 'up' });
  });

  it('fails startup without exposing the underlying SMTP diagnostic', async () => {
    const transporter = makeTransporter();
    transporter.verify.mockRejectedValue(
      new Error('smtp://mailer:secret@smtp.example.com'),
    );
    const adapter = new SmtpMailDeliveryAdapter(config, transporter);

    const error = await adapter
      .onModuleInit()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toBe('Error: SMTP connectivity verification failed');
    expect(String(error)).not.toContain('secret');
    expect(adapter.readiness()).toEqual({
      status: 'down',
      message: 'SMTP connectivity verification failed',
    });
  });

  it('marks readiness down when delivery fails while returning a generic error', async () => {
    const transporter = makeTransporter();
    transporter.sendMail.mockRejectedValue(
      new Error('rejected private-recipient@example.com with token=secret'),
    );
    const adapter = new SmtpMailDeliveryAdapter(config, transporter);
    await adapter.onModuleInit();

    const error = await adapter
      .send(message)
      .catch((caught: unknown) => caught);

    expect(String(error)).toBe('Error: SMTP message delivery failed');
    expect(String(error)).not.toContain('private-recipient');
    expect(String(error)).not.toContain('secret');
    expect(adapter.readiness()).toEqual({
      status: 'down',
      message: 'SMTP message delivery failed',
    });
  });

  it('closes the SMTP pool during application shutdown', () => {
    const transporter = makeTransporter();
    const adapter = new SmtpMailDeliveryAdapter(config, transporter);

    adapter.onModuleDestroy();

    expect(transporter.close).toHaveBeenCalledTimes(1);
  });
});
