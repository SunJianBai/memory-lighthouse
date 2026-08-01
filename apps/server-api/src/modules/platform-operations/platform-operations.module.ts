import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { MemoryModule } from '../memory/memory.module';
import { DevelopmentContentInspectionPolicy } from './config/development-content-inspection.policy';
import { PlatformOperationsController } from './http/platform-operations.controller';
import { PlatformRoleGuard } from './http/platform-role.guard';
import { PlatformOperationsApplicationService } from './platform-operations.application.service';

@Module({
  imports: [PrismaModule, IdentityModule, MemoryModule],
  controllers: [PlatformOperationsController],
  providers: [
    DevelopmentContentInspectionPolicy,
    PlatformRoleGuard,
    PlatformOperationsApplicationService,
  ],
  exports: [
    DevelopmentContentInspectionPolicy,
    PlatformRoleGuard,
    PlatformOperationsApplicationService,
  ],
})
export class PlatformOperationsModule {}
