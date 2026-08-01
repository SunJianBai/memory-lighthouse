import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import type { UserPrincipal } from '../../identity/identity.types';
import { HouseholdApplicationService } from '../household.application.service';
import type {
  HouseholdInvitationView,
  HouseholdMemberView,
  HouseholdView,
} from '../household.types';
import {
  CreateHouseholdDto,
  CreateHouseholdInvitationDto,
  UpdateHouseholdDto,
  UpdateHouseholdMemberDto,
  VersionQueryDto,
} from './household.dto';

@Controller('households')
@UseGuards(UserAccessGuard)
export class HouseholdsController {
  constructor(private readonly households: HouseholdApplicationService) {}

  @Get()
  list(@CurrentUser() principal: UserPrincipal): Promise<HouseholdView[]> {
    return this.households.listHouseholds(principal);
  }

  @Post()
  create(
    @CurrentUser() principal: UserPrincipal,
    @Body() body: CreateHouseholdDto,
  ): Promise<HouseholdView> {
    return this.households.createHousehold(principal, body);
  }

  @Get(':householdId')
  get(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
  ): Promise<HouseholdView> {
    return this.households.getHousehold(principal, householdId);
  }

  @Patch(':householdId')
  update(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Body() body: UpdateHouseholdDto,
  ): Promise<HouseholdView> {
    return this.households.updateHousehold(principal, householdId, body);
  }

  @Get(':householdId/members')
  listMembers(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
  ): Promise<HouseholdMemberView[]> {
    return this.households.listMembers(principal, householdId);
  }

  @Patch(':householdId/members/:memberId')
  updateMember(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('memberId') memberId: string,
    @Body() body: UpdateHouseholdMemberDto,
  ): Promise<HouseholdMemberView> {
    return this.households.updateMember(principal, householdId, memberId, {
      roleCodes: body.roleCodes,
      version: body.version,
    });
  }

  @Delete(':householdId/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('memberId') memberId: string,
    @Query() query: VersionQueryDto,
  ): Promise<void> {
    await this.households.removeMember(
      principal,
      householdId,
      memberId,
      query.version,
    );
  }

  @Post(':householdId/invitations')
  createInvitation(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Body() body: CreateHouseholdInvitationDto,
  ): Promise<HouseholdInvitationView> {
    return this.households.createInvitation(principal, householdId, body);
  }
}
