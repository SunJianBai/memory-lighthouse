import { describe, expect, it } from '@jest/globals';

import { InMemoryMailDeliveryAdapter } from '../../../infrastructure/mail/adapters/in-memory-mail-delivery.adapter';
import type { MailDeliveryConfig } from '../../../infrastructure/mail';
import { HouseholdInvitationMailAdapter } from './household-invitation-mail.adapter';

const config: MailDeliveryConfig = {
  environment: 'test',
  mode: 'memory',
  publicAppUrl: 'https://sun227454.online/',
  fromName: '守忆灯塔',
  fromAddress: 'no-reply@example.com',
};

describe('HouseholdInvitationMailAdapter', () => {
  it('escapes household content and creates an /openBMB invitation link', async () => {
    const delivery = new InMemoryMailDeliveryAdapter(config);
    const adapter = new HouseholdInvitationMailAdapter(delivery, config);

    await adapter.sendHouseholdInvitation({
      invitationId: 'invitation-1',
      householdId: 'household-1',
      householdName: '<script>alert(1)</script>\r\nBcc: victim@example.com',
      targetEmail: 'family@example.com',
      roleCode: 'CAREGIVER',
      rawToken: 'raw+invitation/&?',
      expiresAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const [mail] = delivery.drainForTesting();
    expect(mail).toMatchObject({
      category: 'HOUSEHOLD_INVITATION',
      to: 'family@example.com',
      subject: '守忆灯塔家庭邀请',
    });
    expect(mail.text).toContain('/openBMB/invitations/accept#');
    expect(mail.text).not.toContain('\r');
    expect(mail.text).not.toContain('\nBcc:');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('%26');
  });
});
