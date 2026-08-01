import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import {
  ADMIN_ACCESS_PAGE_DEFAULT,
  ADMIN_ACCESS_PAGE_MAX,
} from '../notification.constants';

export class AdminAccessFeedQueryDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_ACCESS_PAGE_MAX)
  limit: number = ADMIN_ACCESS_PAGE_DEFAULT;
}
