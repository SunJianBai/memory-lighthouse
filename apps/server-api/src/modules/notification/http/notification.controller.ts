import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  CurrentUser,
  UserAccessGuard,
  type UserPrincipal,
} from '../../identity';
import { NotificationApplicationService } from '../notification.application.service';
import type {
  AdminAccessPage,
  MarkAdminAccessReadResult,
} from '../notification.types';
import { AdminAccessFeedQueryDto } from './notification.dto';

@Controller('households/:householdId/privacy/admin-accesses')
@UseGuards(UserAccessGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationApplicationService) {}

  @Get()
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  listAdminAccesses(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Query() query: AdminAccessFeedQueryDto,
  ): Promise<AdminAccessPage> {
    return this.notifications.listAdminAccesses({
      userId: principal.userId,
      householdId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post(':inspectionId/read')
  @HttpCode(HttpStatus.OK)
  markAdminAccessRead(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('inspectionId') inspectionId: string,
  ): Promise<MarkAdminAccessReadResult> {
    return this.notifications.markAdminAccessRead({
      userId: principal.userId,
      householdId,
      inspectionId,
    });
  }
}
