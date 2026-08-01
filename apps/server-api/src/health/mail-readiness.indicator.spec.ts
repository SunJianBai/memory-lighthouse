import { describe, expect, it } from '@jest/globals';

import type { MailDeliveryPort } from '../infrastructure/mail';
import { MailReadinessIndicator } from './mail-readiness.indicator';

describe('MailReadinessIndicator', () => {
  it('makes a recorded SMTP delivery failure visible to readiness', async () => {
    const delivery: MailDeliveryPort = {
      send: () => Promise.resolve(),
      readiness: () => ({
        status: 'down',
        message: 'SMTP message delivery failed',
      }),
    };

    await expect(new MailReadinessIndicator(delivery).check()).resolves.toEqual(
      {
        name: 'mail',
        status: 'down',
        message: 'SMTP message delivery failed',
      },
    );
  });
});
