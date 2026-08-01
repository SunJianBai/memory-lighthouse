import { Inject, Injectable } from '@nestjs/common';

import {
  MAIL_DELIVERY_CONFIG,
  MAIL_DELIVERY_PORT,
  type MailDeliveryConfig,
  type MailDeliveryPort,
} from '../../../infrastructure/mail';
import {
  buildPublicAppLink,
  escapeHtml,
  sanitizePlainText,
} from '../../../infrastructure/mail/mail-content';
import type {
  HouseholdInvitationDelivery,
  InvitationDeliveryPort,
} from '../ports/invitation-delivery.port';

const ROLE_LABELS: Readonly<Record<string, string>> = {
  OWNER: '家庭所有者',
  CAREGIVER: '照护者',
  VIEWER: '查看者',
};

@Injectable()
export class HouseholdInvitationMailAdapter implements InvitationDeliveryPort {
  constructor(
    @Inject(MAIL_DELIVERY_PORT)
    private readonly mail: MailDeliveryPort,
    @Inject(MAIL_DELIVERY_CONFIG)
    private readonly config: MailDeliveryConfig,
  ) {}

  sendHouseholdInvitation(
    invitation: HouseholdInvitationDelivery,
  ): Promise<void> {
    const link = buildPublicAppLink(
      this.config.publicAppUrl,
      '/openBMB/invitations/accept',
      invitation.rawToken,
    );
    const householdName = sanitizePlainText(invitation.householdName);
    const role = ROLE_LABELS[invitation.roleCode] ?? '家庭成员';
    const expiresAt = invitation.expiresAt.toISOString();

    return this.mail.send({
      category: 'HOUSEHOLD_INVITATION',
      to: invitation.targetEmail,
      subject: '守忆灯塔家庭邀请',
      text: [
        `你被邀请以“${role}”身份加入家庭“${householdName}”。`,
        `接受邀请：${sanitizePlainText(link)}`,
        `邀请有效期至：${expiresAt}`,
        '如果你不认识邀请人，请忽略此邮件。',
      ].join('\n\n'),
      html: [
        '<!doctype html><html lang="zh-CN"><body>',
        `<p>你被邀请以“${escapeHtml(role)}”身份加入家庭“${escapeHtml(householdName)}”。</p>`,
        `<p><a href="${escapeHtml(link)}">接受家庭邀请</a></p>`,
        `<p>邀请有效期至：${escapeHtml(expiresAt)}</p>`,
        '<p>如果你不认识邀请人，请忽略此邮件。</p>',
        '</body></html>',
      ].join(''),
    });
  }
}
