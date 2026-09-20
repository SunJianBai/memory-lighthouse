import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import type { UserPrincipal } from '../../identity/identity.types';
import { CareHistoryService } from '../care-history.service';
import {
  CareHistoryQueryDto,
  OccurrenceHistoryQueryDto,
} from './care-history.dto';

@Controller('households/:householdId/care-recipients/:recipientId')
@UseGuards(UserAccessGuard)
export class CareHistoryController {
  constructor(private readonly history: CareHistoryService) {}

  @Get('occurrences/history')
  occurrences(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Query() query: OccurrenceHistoryQueryDto,
  ) {
    return this.history.read(
      principal,
      householdId,
      recipientId,
      'occurrences',
      query,
    );
  }

  @Get('events/history')
  events(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Query() query: CareHistoryQueryDto,
  ) {
    return this.history.read(
      principal,
      householdId,
      recipientId,
      'events',
      query,
    );
  }
}
