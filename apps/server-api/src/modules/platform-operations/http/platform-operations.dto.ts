import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CONTENT_INSPECTION_MAX_TTL_SECONDS,
  INSPECTION_DATA_CATEGORIES,
  PLATFORM_PAGE_DEFAULT,
  PLATFORM_PAGE_MAX,
  type InspectionDataCategory,
} from '../platform-operations.constants';
import { COMPANION_PROMPT_TEMPLATE_MAX_CHARS } from '../../companion-session/companion-prompt';

export class PlatformPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PLATFORM_PAGE_MAX)
  limit: number = PLATFORM_PAGE_DEFAULT;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;
}

export class InspectionGrantPageQueryDto extends PlatformPageQueryDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  householdId?: string;
}

export class RequestInspectionGrantDto {
  @IsString()
  @Length(26, 26)
  householdId!: string;

  @IsOptional()
  @IsString()
  @Length(26, 26)
  recipientId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INSPECTION_DATA_CATEGORIES.length)
  @ArrayUnique()
  @IsIn(INSPECTION_DATA_CATEGORIES, { each: true })
  dataCategories!: InspectionDataCategory[];

  @IsString()
  @Length(1, 1000)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  ticketReference?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(CONTENT_INSPECTION_MAX_TTL_SECONDS)
  expiresInSeconds: number = CONTENT_INSPECTION_MAX_TTL_SECONDS;
}

export class InspectionQueryDto {
  @IsString()
  @Length(26, 26)
  grantId!: string;
}

export class MemoryInspectionQueryDto extends InspectionQueryDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  revisionId?: string;
}

export class PublishCompanionPromptDto {
  @IsString()
  @Length(26, 26)
  expectedCurrentPromptId!: string;

  @IsString()
  @Length(1, COMPANION_PROMPT_TEMPLATE_MAX_CHARS)
  @Matches(/\S/u)
  content!: string;

  @IsString()
  @Length(1, 100)
  @Matches(/\S/u)
  reason!: string;
}
