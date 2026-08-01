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

import {
  CurrentUser,
  UserAccessGuard,
  type UserPrincipal,
} from '../../identity';
import type { TrustedContactView } from '../memory.types';
import { TrustedContactApplicationService } from '../trusted-contact.application.service';
import {
  CreateTrustedContactDto,
  UpdateTrustedContactDto,
  VersionQueryDto,
} from './memory.dto';

@Controller('households/:householdId')
@UseGuards(UserAccessGuard)
export class TrustedContactController {
  constructor(private readonly contacts: TrustedContactApplicationService) {}

  @Get('care-recipients/:recipientId/trusted-contacts')
  list(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ): Promise<TrustedContactView[]> {
    return this.contacts.list(principal.userId, householdId, recipientId);
  }

  @Post('care-recipients/:recipientId/trusted-contacts')
  create(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Body() body: CreateTrustedContactDto,
  ): Promise<TrustedContactView> {
    return this.contacts.create({
      principal,
      householdId,
      recipientId,
      ...body,
    });
  }

  @Patch('trusted-contacts/:contactId')
  update(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('contactId') contactId: string,
    @Body() body: UpdateTrustedContactDto,
  ): Promise<TrustedContactView> {
    return this.contacts.update({ principal, householdId, contactId, ...body });
  }

  @Delete('trusted-contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('contactId') contactId: string,
    @Query() query: VersionQueryDto,
  ): Promise<void> {
    return this.contacts.remove(
      principal.userId,
      householdId,
      contactId,
      query.version,
    );
  }
}
