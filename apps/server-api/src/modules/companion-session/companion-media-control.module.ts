import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { CompanionMediaControlService } from './companion-media-control.service';

@Module({
  imports: [PrismaModule],
  providers: [CompanionMediaControlService],
  exports: [CompanionMediaControlService],
})
export class CompanionMediaControlModule {}
