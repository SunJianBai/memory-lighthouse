import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import type {
  MailDeliveryConfig,
  MailDeliveryPort,
  MailDeliveryReadiness,
  OutboundMailMessage,
} from '../mail.types';
import { assertSafeOutboundMail } from '../mail-content';

type MailTransporter = Pick<Transporter, 'close' | 'sendMail' | 'verify'>;

export class SmtpMailDeliveryAdapter
  implements MailDeliveryPort, OnModuleInit, OnModuleDestroy
{
  private readonly transporter: MailTransporter;
  private status: MailDeliveryReadiness = {
    status: 'down',
    message: 'SMTP startup verification has not completed',
  };

  constructor(
    private readonly config: MailDeliveryConfig,
    transporter?: MailTransporter,
  ) {
    const smtp = config.smtp;
    if (config.mode !== 'smtp' || !smtp) {
      throw new Error('SMTP mail adapter requires SMTP configuration');
    }

    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        requireTLS: smtp.requireTls,
        auth:
          smtp.username && smtp.password
            ? { user: smtp.username, pass: smtp.password }
            : undefined,
        connectionTimeout: smtp.connectionTimeoutMs,
        greetingTimeout: smtp.greetingTimeoutMs,
        socketTimeout: smtp.socketTimeoutMs,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.transporter.verify();
      this.status = { status: 'up' };
    } catch {
      this.status = {
        status: 'down',
        message: 'SMTP connectivity verification failed',
      };
      throw new Error('SMTP connectivity verification failed');
    }
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }

  async send(message: OutboundMailMessage): Promise<void> {
    assertSafeOutboundMail(message);
    try {
      await this.transporter.sendMail({
        from: {
          name: this.config.fromName,
          address: this.config.fromAddress,
        },
        to: [{ address: message.to, name: '' }],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: {
          'X-OpenBMB-Mail-Category': message.category,
          'Auto-Submitted': 'auto-generated',
        },
      });
      this.status = { status: 'up' };
    } catch {
      this.status = {
        status: 'down',
        message: 'SMTP message delivery failed',
      };
      throw new Error('SMTP message delivery failed');
    }
  }

  readiness(): MailDeliveryReadiness {
    return { ...this.status };
  }
}
