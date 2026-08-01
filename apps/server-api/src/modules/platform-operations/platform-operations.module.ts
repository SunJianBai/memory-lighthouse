import { DynamicModule, Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { RateLimitModule } from '../../infrastructure/rate-limit/rate-limit.module';
import { IdentityModule } from '../identity/identity.module';
import { MemoryModule } from '../memory/memory.module';
import { NotificationModule } from '../notification';
import { DevelopmentContentInspectionPolicy } from './config/development-content-inspection.policy';
import { AdminAuthenticationApplicationService } from './admin-authentication.application.service';
import { AdminAuthController } from './http/admin-auth.controller';
import { DevelopmentContentInspectionController } from './http/development-content-inspection.controller';
import { PlatformOperationsController } from './http/platform-operations.controller';
import { PlatformRoleGuard } from './http/platform-role.guard';
import { PlatformAuditIpHasher } from './platform-audit-ip-hasher';
import { PlatformOperationsApplicationService } from './platform-operations.application.service';
import { PlatformRoleAuthorizer } from './platform-role.authorizer';

export function platformOperationsControllersFor(
  environment: string | undefined,
) {
  const controllers = [AdminAuthController, PlatformOperationsController];
  return environment === 'production'
    ? controllers
    : [...controllers, DevelopmentContentInspectionController];
}

@Module({
  imports: [
    PrismaModule,
    RateLimitModule,
    IdentityModule,
    MemoryModule,
    NotificationModule,
  ],
  providers: [
    AdminAuthenticationApplicationService,
    DevelopmentContentInspectionPolicy,
    PlatformAuditIpHasher,
    PlatformRoleAuthorizer,
    PlatformRoleGuard,
    PlatformOperationsApplicationService,
  ],
  exports: [
    DevelopmentContentInspectionPolicy,
    PlatformRoleAuthorizer,
    PlatformRoleGuard,
    PlatformOperationsApplicationService,
  ],
})
export class PlatformOperationsModule {
  static register(environment: string | undefined): DynamicModule {
    return {
      module: PlatformOperationsModule,
      controllers: platformOperationsControllersFor(environment),
    };
  }
}
