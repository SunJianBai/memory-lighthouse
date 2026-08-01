import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
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
  MAX_ASSET_BYTES,
  MEMORY_PAGE_DEFAULT,
  MEMORY_PAGE_MAX,
  MEMORY_SENSITIVITIES,
  MEMORY_VERIFICATION_STATUSES,
} from '../memory.constants';

export class ListMemoriesQueryDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MEMORY_PAGE_MAX)
  limit: number = MEMORY_PAGE_DEFAULT;
}

export class CreateMemoryDto {
  @IsString()
  @Length(1, 32)
  kind!: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 20_000)
  content!: string;

  @IsString()
  @Matches(new RegExp(`^(${MEMORY_SENSITIVITIES.join('|')})$`))
  sensitivity: string = 'SENSITIVE';

  @IsString()
  @Matches(new RegExp(`^(${MEMORY_VERIFICATION_STATUSES.join('|')})$`))
  verificationStatus: string = 'FAMILY_REPORTED';

  @IsOptional()
  @IsString()
  @Matches(/^(FAMILY|IMPORT)$/)
  source?: string;
}

export class UpdateMemoryDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  kind?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20_000)
  content?: string;

  @IsOptional()
  @IsString()
  @Matches(new RegExp(`^(${MEMORY_SENSITIVITIES.join('|')})$`))
  sensitivity?: string;

  @IsOptional()
  @IsString()
  @Matches(new RegExp(`^(${MEMORY_VERIFICATION_STATUSES.join('|')})$`))
  verificationStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;

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

export class OptionalVersionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version?: number;
}

export class CreateUploadIntentDto {
  @IsString()
  @Length(26, 26)
  recipientId!: string;

  @IsString()
  @Length(1, 255)
  originalName!: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+\-/]{0,126}$/)
  mimeType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ASSET_BYTES)
  byteSize!: number;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  sha256!: string;

  @IsString()
  @Length(1, 32)
  kind!: string;
}

export class CompleteUploadDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class CreateMedicationDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  alias?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  purpose?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  requirements?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  containerLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  containerLocation?: string | null;
}

export class UpdateMedicationDto extends CreateMedicationDto {
  @IsOptional()
  declare name: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class CreateTrustedContactDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  householdMemberId?: string | null;

  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Length(1, 50)
  relationshipLabel!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+0-9 ()-]{3,32}$/)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  priority: number = 1;

  @IsBoolean()
  canViewEvidence: boolean = false;
}

export class UpdateTrustedContactDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  householdMemberId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  relationshipLabel?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+0-9 ()-]{3,32}$/)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  canViewEvidence?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}
