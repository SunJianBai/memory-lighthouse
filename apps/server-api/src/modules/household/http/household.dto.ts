import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { HOUSEHOLD_ROLE_CODES } from '../household.constants';

export enum HouseholdRoleCodeDto {
  OWNER = 'OWNER',
  CAREGIVER = 'CAREGIVER',
  VIEWER = 'VIEWER',
}

export class CreateHouseholdDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;
}

export class UpdateHouseholdDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class UpdateHouseholdMemberDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(HOUSEHOLD_ROLE_CODES.length)
  @IsEnum(HouseholdRoleCodeDto, { each: true })
  roleCodes!: HouseholdRoleCodeDto[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class VersionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class CreateHouseholdInvitationDto {
  @IsEmail()
  @MaxLength(320)
  targetEmail!: string;

  @IsEnum(HouseholdRoleCodeDto)
  roleCode!: HouseholdRoleCodeDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15 * 60)
  @Max(7 * 24 * 60 * 60)
  expiresInSeconds?: number;
}

export class AcceptHouseholdInvitationDto {
  @IsString()
  @Length(32, 512)
  token!: string;
}

export class CreateCareRecipientDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  preferredName?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  birthDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  homeLabel?: string;
}

export class UpdateCareRecipientDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  preferredName?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  birthDate?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  homeLabel?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class PutCareAuthorityDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  relationshipLabel?: string | null;

  @IsString()
  @Length(1, 32)
  accessLevel!: string;

  @IsBoolean()
  canManageProfile!: boolean;

  @IsBoolean()
  canManageConsent!: boolean;

  @IsBoolean()
  canManageRoutine!: boolean;

  @IsBoolean()
  canViewEvents!: boolean;

  @IsBoolean()
  canViewConversation!: boolean;

  @IsBoolean()
  canActivateDevice!: boolean;

  @IsBoolean()
  canRemoteCall!: boolean;

  @IsBoolean()
  receiveNotifications!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  contactPriority?: number | null;

  @IsIn(['ACTIVE', 'REVOKED'])
  status!: 'ACTIVE' | 'REVOKED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version?: number;
}
