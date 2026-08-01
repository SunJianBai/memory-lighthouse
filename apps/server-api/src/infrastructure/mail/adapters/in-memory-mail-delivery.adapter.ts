import type {
  MailDeliveryConfig,
  MailDeliveryPort,
  MailDeliveryReadiness,
  OutboundMailMessage,
} from '../mail.types';
import { assertSafeOutboundMail } from '../mail-content';

/** Development/test transport. Messages are retained in-process and never logged. */
export class InMemoryMailDeliveryAdapter implements MailDeliveryPort {
  private readonly messages: OutboundMailMessage[] = [];

  constructor(config: MailDeliveryConfig) {
    if (config.environment === 'production') {
      throw new Error('In-memory mail delivery is forbidden in production');
    }
  }

  send(message: OutboundMailMessage): Promise<void> {
    assertSafeOutboundMail(message);
    this.messages.push(structuredClone(message));
    return Promise.resolve();
  }

  readiness(): MailDeliveryReadiness {
    return { status: 'up' };
  }

  drainForTesting(): OutboundMailMessage[] {
    return this.messages.splice(0, this.messages.length);
  }
}
