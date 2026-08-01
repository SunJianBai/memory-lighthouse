import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { InMemoryMailDeliveryAdapter } from './adapters/in-memory-mail-delivery.adapter';
import { SmtpMailDeliveryAdapter } from './adapters/smtp-mail-delivery.adapter';
import { createMailDeliveryConfig } from './mail.config';
import { MAIL_DELIVERY_CONFIG, MAIL_DELIVERY_PORT } from './mail.constants';
import type { MailDeliveryConfig, MailDeliveryPort } from './mail.types';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAIL_DELIVERY_CONFIG,
      inject: [ConfigService],
      useFactory: createMailDeliveryConfig,
    },
    {
      provide: MAIL_DELIVERY_PORT,
      inject: [MAIL_DELIVERY_CONFIG],
      useFactory: (config: MailDeliveryConfig): MailDeliveryPort =>
        config.mode === 'smtp'
          ? new SmtpMailDeliveryAdapter(config)
          : new InMemoryMailDeliveryAdapter(config),
    },
  ],
  exports: [MAIL_DELIVERY_CONFIG, MAIL_DELIVERY_PORT],
})
export class MailModule {}
