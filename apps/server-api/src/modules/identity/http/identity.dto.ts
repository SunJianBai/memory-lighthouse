import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const USERNAME_PATTERN = /^[\p{L}\p{N}._-]+$/u;

export enum ClientTypeDto {
  WEB = 'WEB',
  ANDROID = 'ANDROID',
}

export class RegisterDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(3, 32)
  @Matches(USERNAME_PATTERN)
  username?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsEnum(ClientTypeDto)
  clientType: ClientTypeDto = ClientTypeDto.WEB;
}

export class LoginDto {
  @IsString()
  @Length(3, 320)
  identifier!: string;

  @IsString()
  @MaxLength(128)
  password!: string;

  @IsEnum(ClientTypeDto)
  clientType: ClientTypeDto = ClientTypeDto.WEB;
}

export class RefreshDto {
  @IsEnum(ClientTypeDto)
  clientType: ClientTypeDto = ClientTypeDto.WEB;

  @IsOptional()
  @IsString()
  @Length(32, 512)
  refreshToken?: string;
}

export class EmailVerificationRequestDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class OneTimeTokenConfirmDto {
  @IsString()
  @Length(32, 512)
  token!: string;
}

export class PasswordResetRequestDto {
  @IsString()
  @Length(3, 320)
  identifier!: string;
}

export class PasswordResetConfirmDto extends OneTimeTokenConfirmDto {
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword!: string;
}
