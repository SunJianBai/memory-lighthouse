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
import { MedicationApplicationService } from '../medication.application.service';
import type { MedicationView } from '../memory.types';
import {
  CreateMedicationDto,
  UpdateMedicationDto,
  VersionQueryDto,
} from './memory.dto';

@Controller('households/:householdId')
@UseGuards(UserAccessGuard)
export class MedicationController {
  constructor(private readonly medications: MedicationApplicationService) {}

  @Get('care-recipients/:recipientId/medications')
  list(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ): Promise<MedicationView[]> {
    return this.medications.list(principal.userId, householdId, recipientId);
  }

  @Post('care-recipients/:recipientId/medications')
  create(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Body() input: CreateMedicationDto,
  ): Promise<MedicationView> {
    return this.medications.create({
      principal,
      householdId,
      recipientId,
      ...input,
    });
  }

  @Patch('medications/:medicationId')
  update(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('medicationId') medicationId: string,
    @Body() input: UpdateMedicationDto,
  ): Promise<MedicationView> {
    return this.medications.update({
      principal,
      householdId,
      medicationId,
      ...input,
    });
  }

  @Delete('medications/:medicationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('medicationId') medicationId: string,
    @Query() query: VersionQueryDto,
  ): Promise<void> {
    return this.medications.remove(
      principal.userId,
      householdId,
      medicationId,
      query.version,
    );
  }
}
