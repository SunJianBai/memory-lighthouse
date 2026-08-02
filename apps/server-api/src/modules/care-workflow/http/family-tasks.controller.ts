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
import type { FamilyTaskView } from '../care-workflow.types';
import {
  ClaimFamilyTaskDto,
  FamilyTaskQueryDto,
  FinishFamilyTaskDto,
} from './care-workflow.dto';
import { requireMatchingIdempotencyKey } from './idempotency-key';

@Controller('households/:householdId/family-tasks')
@UseGuards(UserAccessGuard)
export class FamilyTasksController {
  constructor(private readonly workflow: CareWorkflowApplicationService) {}

  @Get()
  list(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Query() query: FamilyTaskQueryDto,
  ): Promise<FamilyTaskView[]> {
    return this.workflow.listFamilyTasks(principal, householdId, query);
  }

  @Post(':taskId/claim')
  claim(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('taskId') taskId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ClaimFamilyTaskDto,
  ): Promise<FamilyTaskView> {
    return this.workflow.claimFamilyTask(principal, householdId, taskId, {
      ...body,
      idempotencyKey: requireMatchingIdempotencyKey(idempotencyKey),
    });
  }

  @Post(':taskId/resolve')
  resolve(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('taskId') taskId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: FinishFamilyTaskDto,
  ): Promise<FamilyTaskView> {
    return this.workflow.resolveFamilyTask(principal, householdId, taskId, {
      ...body,
      idempotencyKey: requireMatchingIdempotencyKey(idempotencyKey),
    });
  }

  @Post(':taskId/dismiss')
  dismiss(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('taskId') taskId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: FinishFamilyTaskDto,
  ): Promise<FamilyTaskView> {
    return this.workflow.dismissFamilyTask(principal, householdId, taskId, {
      ...body,
      idempotencyKey: requireMatchingIdempotencyKey(idempotencyKey),
    });
  }
}
