import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import type { UserPrincipal } from '../../identity/identity.types';
import { CareWorkflowApplicationService } from '../care-workflow.application.service';
import type { CareEventView, OccurrenceView } from '../care-workflow.types';
import {
  ConfirmOccurrenceDto,
  FamilyVerifyOccurrenceDto,
  OccurrenceQueryDto,
} from './care-workflow.dto';
import { requireMatchingIdempotencyKey } from './idempotency-key';

@Controller('households/:householdId')
@UseGuards(UserAccessGuard)
export class OccurrencesController {
  constructor(private readonly workflow: CareWorkflowApplicationService) {}

  @Get('care-recipients/:recipientId/occurrences')
  list(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Query() query: OccurrenceQueryDto,
  ): Promise<OccurrenceView[]> {
    return this.workflow.listOccurrences(principal, householdId, recipientId, {
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      ...(query.status ? { status: query.status } : {}),
    });
  }

  @Post('occurrences/:occurrenceId/confirm')
  confirm(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ConfirmOccurrenceDto,
  ): Promise<OccurrenceView> {
    return this.workflow.confirmOccurrence(
      principal,
      householdId,
      occurrenceId,
      {
        ...body,
        idempotencyKey: requireMatchingIdempotencyKey(
          idempotencyKey,
          body.idempotencyKey,
        ),
      },
    );
  }

  @Post('occurrences/:occurrenceId/family-verify')
  familyVerify(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: FamilyVerifyOccurrenceDto,
  ): Promise<OccurrenceView> {
    return this.workflow.familyVerifyOccurrence(
      principal,
      householdId,
      occurrenceId,
      {
        ...body,
        idempotencyKey: requireMatchingIdempotencyKey(
          idempotencyKey,
          body.idempotencyKey,
        ),
      },
    );
  }

  @Get('care-recipients/:recipientId/events')
  listEvents(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ): Promise<CareEventView[]> {
    return this.workflow.listCareEvents(principal, householdId, recipientId);
  }
}
