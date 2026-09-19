import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import { CurrentUser } from '../../identity/http/current-user.decorator';
import type { UserPrincipal } from '../../identity/identity.types';
import { TodayCareService } from '../today-care.service';

@Controller('households/:householdId/care-recipients/:recipientId/today-care')
@UseGuards(UserAccessGuard)
export class TodayCareController {
  constructor(private readonly today: TodayCareService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  read(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ) {
    return this.today.read(principal, householdId, recipientId);
  }
}
