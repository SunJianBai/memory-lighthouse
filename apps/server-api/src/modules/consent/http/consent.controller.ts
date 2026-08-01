import {
  Body,
  Controller,
  Get,
  Headers,
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
import { ConsentApplicationService } from '../consent.application.service';
import type {
  ConsentEventPage,
  ConsentEventView,
  ConsentStateView,
} from '../consent.types';
import { IdempotencyKeyRequiredException } from '../consent.errors';
import { DecideConsentDto, ListConsentEventsQueryDto } from './consent.dto';

@Controller('households/:householdId/care-recipients/:recipientId')
@UseGuards(UserAccessGuard)
export class ConsentController {
  constructor(private readonly consent: ConsentApplicationService) {}

  @Get('consents')
  listConsents(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ): Promise<ConsentStateView[]> {
    return this.consent.listConsents(
      principal.userId,
      householdId,
      recipientId,
    );
  }

  @Post('consents/:scope/grant')
  @HttpCode(HttpStatus.OK)
  grant(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Param('scope') scope: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: DecideConsentDto,
  ): Promise<ConsentEventView> {
    return this.consent.grantConsent({
      userId: principal.userId,
      householdId,
      recipientId,
      scope,
      documentVersionId: input.documentVersionId,
      reason: input.reason,
      idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
    });
  }

  @Post('consents/:scope/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Param('scope') scope: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: DecideConsentDto,
  ): Promise<ConsentEventView> {
    return this.consent.revokeConsent({
      userId: principal.userId,
      householdId,
      recipientId,
      scope,
      documentVersionId: input.documentVersionId,
      reason: input.reason,
      idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
    });
  }

  @Get('consent-events')
  listEvents(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Query() query: ListConsentEventsQueryDto,
  ): Promise<ConsentEventPage> {
    return this.consent.listConsentEvents({
      userId: principal.userId,
      householdId,
      recipientId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length < 8 || normalized.length > 128) {
      throw new IdempotencyKeyRequiredException();
    }
    return normalized;
  }
}
