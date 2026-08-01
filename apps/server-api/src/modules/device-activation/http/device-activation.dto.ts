import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export enum DevicePlatformDto {
  ANDROID = 'ANDROID',
  WEB = 'WEB',
}

export enum ActivationProofTypeDto {
  QR_SECRET = 'QR_SECRET',
  DYNAMIC_CODE = 'DYNAMIC_CODE',
}

export class RegisterDeviceInstallationDto {
  @IsString()
  @Length(40, 684)
  @Matches(BASE64URL_PATTERN)
  installationPublicKeySpki!: string;

  @IsEnum(DevicePlatformDto)
  platform!: DevicePlatformDto;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  manufacturer?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  model?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  appVersion?: string;
}

export class ClaimActivationChallengeDto {
  @IsString()
  @Length(26, 26)
  installationId!: string;

  @IsString()
  @Length(43, 43)
  @Matches(BASE64URL_PATTERN)
  serverNonce!: string;

  @IsEnum(ActivationProofTypeDto)
  proofType!: ActivationProofTypeDto;

  @IsString()
  @Length(8, 128)
  proof!: string;

  @IsString()
  @Length(86, 86)
  @Matches(BASE64URL_PATTERN)
  signature!: string;
}

export class ExchangeDeviceCredentialDto {
  @IsString()
  @Length(26, 26)
  challengeId!: string;

  @IsString()
  @Length(26, 26)
  installationId!: string;

  @IsString()
  @Length(86, 86)
  @Matches(BASE64URL_PATTERN)
  signature!: string;
}

export class RefreshDeviceCredentialDto {
  @IsString()
  @Length(43, 43)
  @Matches(BASE64URL_PATTERN)
  credential!: string;

  @IsString()
  @Length(86, 86)
  @Matches(BASE64URL_PATTERN)
  signature!: string;
}

export class CancelActivationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;
}

export class UpdateCompanionBindingDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}

export class RevokeCompanionBindingDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;
}
