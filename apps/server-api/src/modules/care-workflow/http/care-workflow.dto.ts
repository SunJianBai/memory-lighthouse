import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { ROUTINE_TYPES } from '../care-workflow.constants';

export class RoutineScheduleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  timezone!: string;

  @IsInt()
  @Min(0)
  @Max(1439)
  localTimeMinutes!: number;

  @IsInt()
  @Min(1)
  @Max(127)
  weekdayMask!: number;

  @IsISO8601({ strict: true })
  startDate!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  endDate?: string | null;

  @IsInt()
  @Min(0)
  @Max(1440)
  graceMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(10080)
  familyNoticeMinutes!: number;
}

export class CreateRoutineDto {
  @IsIn(ROUTINE_TYPES)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(26)
  medicationId?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  instructions!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  confirmationQuestion!: string;

  @ValidateNested()
  @Type(() => RoutineScheduleDto)
  schedule!: RoutineScheduleDto;
}

export class UpdateRoutineDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsOptional()
  @IsIn(ROUTINE_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(26)
  medicationId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  instructions?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  confirmationQuestion?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RoutineScheduleDto)
  schedule?: RoutineScheduleDto;
}

export class VersionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class OccurrenceQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ConfirmOccurrenceDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;

  @IsIn(['RECIPIENT_BUTTON', 'RECIPIENT_VOICE'])
  source!: 'RECIPIENT_BUTTON' | 'RECIPIENT_VOICE';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(26)
  bindingId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(26)
  utteranceId?: string | null;
}

export class FamilyVerifyOccurrenceDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;

  @IsBoolean()
  verified!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class FamilyTaskQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(26)
  recipientId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ClaimFamilyTaskDto {
  @IsInt()
  @Min(0)
  version!: number;
}

export class FinishFamilyTaskDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  resolutionCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
