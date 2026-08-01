import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CONSENT_EVENT_PAGE_DEFAULT,
  CONSENT_EVENT_PAGE_MAX,
} from '../consent.constants';

export class DecideConsentDto {
  @IsString()
  @Length(26, 26)
  documentVersionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListConsentEventsQueryDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CONSENT_EVENT_PAGE_MAX)
  limit: number = CONSENT_EVENT_PAGE_DEFAULT;
}
