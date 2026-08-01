import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import type { UserPrincipal } from '../../identity/identity.types';
import { HouseholdApplicationService } from '../household.application.service';
import type { CareAuthorityView, CareRecipientView } from '../household.types';
import {
  CreateCareRecipientDto,
  PutCareAuthorityDto,
  UpdateCareRecipientDto,
} from './household.dto';

@Controller('households/:householdId/care-recipients')
@UseGuards(UserAccessGuard)
export class CareRecipientsController {
  constructor(private readonly households: HouseholdApplicationService) {}

  @Get()
  list(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
  ): Promise<CareRecipientView[]> {
    return this.households.listCareRecipients(principal, householdId);
  }

  @Post()
  create(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Body() body: CreateCareRecipientDto,
  ): Promise<CareRecipientView> {
    return this.households.createCareRecipient(principal, householdId, body);
  }

  @Get(':recipientId')
  get(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ): Promise<CareRecipientView> {
    return this.households.getCareRecipient(
      principal,
      householdId,
      recipientId,
    );
  }

  @Patch(':recipientId')
  update(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Body() body: UpdateCareRecipientDto,
  ): Promise<CareRecipientView> {
    return this.households.updateCareRecipient(
      principal,
      householdId,
      recipientId,
      body,
    );
  }

  @Get(':recipientId/authorities')
  getAuthorities(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ): Promise<CareAuthorityView[]> {
    return this.households.getCareAuthorities(
      principal,
      householdId,
      recipientId,
    );
  }

  @Put(':recipientId/authorities/:memberId')
  putAuthority(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Param('memberId') memberId: string,
    @Body() body: PutCareAuthorityDto,
  ): Promise<CareAuthorityView> {
    return this.households.putCareAuthority(
      principal,
      householdId,
      recipientId,
      memberId,
      body,
    );
  }
}
