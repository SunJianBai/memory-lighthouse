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
  EmailVerificationNotification,
  NotificationPort,
  PasswordResetNotification,
} from '../ports/notification.port';

@Injectable()
export class MailNotificationAdapter implements NotificationPort {
  constructor(
    @Inject(MAIL_DELIVERY_PORT)
    private readonly mail: MailDeliveryPort,
    @Inject(MAIL_DELIVERY_CONFIG)
    private readonly config: MailDeliveryConfig,
  ) {}

  sendEmailVerification(
    notification: EmailVerificationNotification,
  ): Promise<void> {
    const link = buildPublicAppLink(
      this.config.publicAppUrl,
      '/openBMB/auth/verify-email',
      notification.token,
    );
    const expiresAt = notification.expiresAt.toISOString();

    return this.mail.send({
      category: 'EMAIL_VERIFICATION',
      to: notification.email,
      subject: '守忆灯塔邮箱验证',
      text: [
        '请验证你的守忆灯塔邮箱。',
        `验证链接：${sanitizePlainText(link)}`,
        `链接有效期至：${expiresAt}`,
        '如果这不是你的操作，请忽略此邮件。',
      ].join('\n\n'),
      html: this.renderActionHtml(
        '验证邮箱',
        '请验证你的守忆灯塔邮箱。',
        link,
        expiresAt,
      ),
    });
  }

  sendPasswordReset(notification: PasswordResetNotification): Promise<void> {
    const link = buildPublicAppLink(
      this.config.publicAppUrl,
      '/openBMB/auth/reset-password',
      notification.token,
    );
    const expiresAt = notification.expiresAt.toISOString();

    return this.mail.send({
      category: 'PASSWORD_RESET',
      to: notification.email,
      subject: '守忆灯塔密码重置',
      text: [
        '有人请求重置你的守忆灯塔账号密码。',
        `重置链接：${sanitizePlainText(link)}`,
        `链接有效期至：${expiresAt}`,
        '如果这不是你的操作，请忽略此邮件，原密码不会改变。',
      ].join('\n\n'),
      html: this.renderActionHtml(
        '重置密码',
        '有人请求重置你的守忆灯塔账号密码。',
        link,
        expiresAt,
      ),
    });
  }

  private renderActionHtml(
    action: string,
    introduction: string,
    link: string,
    expiresAt: string,
  ): string {
    return [
      '<!doctype html><html lang="zh-CN"><body>',
      `<p>${escapeHtml(introduction)}</p>`,
      `<p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p>`,
      `<p>链接有效期至：${escapeHtml(expiresAt)}</p>`,
      '<p>如果这不是你的操作，请忽略此邮件。</p>',
      '</body></html>',
    ].join('');
  }
}
