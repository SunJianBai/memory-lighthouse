import { Inject, Injectable } from '@nestjs/common';

import {
  MAIL_DELIVERY_PORT,
  type MailDeliveryPort,
} from '../infrastructure/mail';
import type {
  ReadinessCheckResult,
  ReadinessIndicator,
} from './readiness-indicator';

@Injectable()
export class MailReadinessIndicator implements ReadinessIndicator {
  readonly name = 'mail';

  constructor(
    @Inject(MAIL_DELIVERY_PORT)
    private readonly delivery: MailDeliveryPort,
  ) {}

  check(): Promise<ReadinessCheckResult> {
    const status = this.delivery.readiness();
    return Promise.resolve({ name: this.name, ...status });
  }
}
