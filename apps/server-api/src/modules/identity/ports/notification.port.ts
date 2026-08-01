export interface EmailVerificationNotification {
  email: string;
  token: string;
  expiresAt: Date;
}

export interface PasswordResetNotification {
  email: string;
  token: string;
  expiresAt: Date;
}

export interface NotificationPort {
  sendEmailVerification(
    notification: EmailVerificationNotification,
  ): Promise<void>;

  sendPasswordReset(notification: PasswordResetNotification): Promise<void>;
}
