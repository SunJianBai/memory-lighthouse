import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { CareWorkflowApplicationService } from '../care-workflow.application.service';
import type { RoutineView } from '../care-workflow.types';
import { requireMatchingIdempotencyKey } from './idempotency-key';
import {
  CreateRoutineDto,
  UpdateRoutineDto,
  VersionQueryDto,
} from './care-workflow.dto';

@Controller('households/:householdId')
@UseGuards(UserAccessGuard)
export class RoutinesController {
  constructor(private readonly workflow: CareWorkflowApplicationService) {}

  @Get('care-recipients/:recipientId/routines')
  list(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ): Promise<RoutineView[]> {
    return this.workflow.listRoutines(principal, householdId, recipientId);
  }

  @Post('care-recipients/:recipientId/routines')
  create(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Body() body: CreateRoutineDto,
  ): Promise<RoutineView> {
    return this.workflow.createRoutine(
      principal,
      householdId,
      recipientId,
      body,
    );
  }

  @Patch('routines/:routineId')
  update(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('routineId') routineId: string,
    @Body() body: UpdateRoutineDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<RoutineView> {
    return this.workflow.updateRoutine(principal, householdId, routineId, {
      ...body,
      // Older clients remain version-guarded; keyed edits additionally support replay.
      ...(idempotencyKey === undefined
        ? {}
        : { idempotencyKey: requireMatchingIdempotencyKey(idempotencyKey) }),
    });
  }

  @Delete('routines/:routineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('routineId') routineId: string,
    @Query() query: VersionQueryDto,
  ): Promise<void> {
    return this.workflow.deleteRoutine(
      principal,
      householdId,
      routineId,
      query.version,
    );
  }
}
