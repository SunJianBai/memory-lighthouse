import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { MailModule } from '../../infrastructure/mail';
import { RateLimitModule } from '../../infrastructure/rate-limit';
import { Argon2PasswordHasherAdapter } from './adapters/argon2-password-hasher.adapter';
import { MailNotificationAdapter } from './adapters/mail-notification.adapter';
import { createIdentitySecurityConfig } from './config/identity-security.config';
import { AccessTokenService } from './crypto/access-token.service';
import { OpaqueTokenService } from './crypto/opaque-token.service';
import { VerifiedEmailPolicy } from './domain/verified-email.policy';
import { IdentityApplicationService } from './identity.application.service';
import {
  IDENTITY_CLOCK,
  IDENTITY_SECURITY_CONFIG,
  NOTIFICATION_PORT,
  PASSWORD_HASHER_PORT,
} from './identity.constants';
import { AuthController } from './http/auth.controller';
import { AdminAccessGuard } from './http/admin-access.guard';
import { MeController } from './http/me.controller';
import { UserAccessGuard } from './http/user-access.guard';
import { SystemClock } from './ports/clock.port';

@Module({
  imports: [PrismaModule, MailModule, RateLimitModule],
  controllers: [AuthController, MeController],
  providers: [
    {
      provide: IDENTITY_SECURITY_CONFIG,
      inject: [ConfigService],
      useFactory: createIdentitySecurityConfig,
    },
    SystemClock,
    { provide: IDENTITY_CLOCK, useExisting: SystemClock },
    Argon2PasswordHasherAdapter,
    { provide: PASSWORD_HASHER_PORT, useExisting: Argon2PasswordHasherAdapter },
    MailNotificationAdapter,
    { provide: NOTIFICATION_PORT, useExisting: MailNotificationAdapter },
    OpaqueTokenService,
    AccessTokenService,
    VerifiedEmailPolicy,
    IdentityApplicationService,
    AdminAccessGuard,
    UserAccessGuard,
  ],
  exports: [
    IDENTITY_SECURITY_CONFIG,
    IdentityApplicationService,
    AdminAccessGuard,
    UserAccessGuard,
    VerifiedEmailPolicy,
  ],
})
export class IdentityModule {}
