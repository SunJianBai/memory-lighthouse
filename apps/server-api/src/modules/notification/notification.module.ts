import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { HouseholdModule } from '../household/household.module';
import { IdentityModule } from '../identity';
import { NotificationController } from './http/notification.controller';
import { NotificationApplicationService } from './notification.application.service';

@Module({
  imports: [PrismaModule, IdentityModule, HouseholdModule],
  controllers: [NotificationController],
  providers: [NotificationApplicationService],
  exports: [NotificationApplicationService],
})
export class NotificationModule {}
