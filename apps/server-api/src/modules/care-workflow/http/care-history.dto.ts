import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OCCURRENCE_STATUS } from '../care-workflow.constants';

export class CareHistoryQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

export class OccurrenceHistoryQueryDto extends CareHistoryQueryDto {
  @IsOptional()
  @IsIn(Object.values(OCCURRENCE_STATUS))
  status?: string;
}
