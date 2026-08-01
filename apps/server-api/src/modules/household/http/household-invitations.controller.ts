import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import type { UserPrincipal } from '../../identity/identity.types';
import { HouseholdApplicationService } from '../household.application.service';
import type { HouseholdMemberView } from '../household.types';
import { AcceptHouseholdInvitationDto } from './household.dto';

@Controller('household-invitations')
@UseGuards(UserAccessGuard)
export class HouseholdInvitationsController {
  constructor(private readonly households: HouseholdApplicationService) {}

  @Post('accept')
  accept(
    @CurrentUser() principal: UserPrincipal,
    @Body() body: AcceptHouseholdInvitationDto,
  ): Promise<HouseholdMemberView> {
    return this.households.acceptInvitation(principal, body.token);
  }
}
