import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  COMPANION_MODES,
  MODEL_EVENT_TYPES,
  UTTERANCE_SOURCES,
  UTTERANCE_SPEAKERS,
  type CompanionMode,
  type ModelEventType,
  type UtteranceSource,
  type UtteranceSpeaker,
} from '../companion-session.constants';

export class StartCompanionSessionDto {
  @IsIn(COMPANION_MODES)
  mode: CompanionMode = 'AUDIO';
}

export class AppendUtteranceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequenceNo!: number;

  @IsIn(UTTERANCE_SPEAKERS)
  speaker!: UtteranceSpeaker;

  @IsIn(UTTERANCE_SOURCES)
  source!: UtteranceSource;

  @IsString()
  @Length(1, 200)
  providerEventId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  rawText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startOffsetMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  endOffsetMs?: number;

  @IsBoolean()
  isFinal: boolean = true;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class AppendModelEventDto {
  @IsIn(MODEL_EVENT_TYPES)
  eventType!: ModelEventType;

  @IsOptional()
  @IsObject()
  metrics?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  errorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  occurredAt?: string;
}

export class EndCompanionSessionDto {
  @IsString()
  @Length(1, 64)
  reason: string = 'DEVICE_ENDED';
}

export class DeviceHeartbeatDto {
  @IsOptional()
  @IsString()
  @Length(26, 26)
  activeCompanionSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  osVersion?: string;
}
