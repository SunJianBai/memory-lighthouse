export type MailDeliveryMode = 'memory' | 'smtp';

export type MailCategory =
  'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'HOUSEHOLD_INVITATION';

export interface OutboundMailMessage {
  category: MailCategory;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailDeliveryReadiness {
  status: 'up' | 'down';
  message?: string;
}

export interface MailDeliveryPort {
  send(message: OutboundMailMessage): Promise<void>;
  readiness(): MailDeliveryReadiness;
}

export interface SmtpMailConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  username: string;
  password: string;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
}

export interface MailDeliveryConfig {
  environment: 'development' | 'test' | 'production';
  mode: MailDeliveryMode;
  publicAppUrl: string;
  fromName: string;
  fromAddress: string;
  smtp?: SmtpMailConfig;
}
