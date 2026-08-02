import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RequestedRemoteMediaDto {
  @IsBoolean()
  receiveDeviceAudio: boolean = true;

  @IsBoolean()
  receiveDeviceVideo: boolean = true;

  @IsBoolean()
  sendFamilyAudio: boolean = true;

  @IsBoolean()
  sendFamilyVideo: boolean = false;
}

export class CreateRemoteSessionDto {
  @IsString()
  @Length(26, 26)
  bindingId!: string;

  @ValidateNested()
  @Type(() => RequestedRemoteMediaDto)
  media!: RequestedRemoteMediaDto;
}

export class UpdateRemotePolicyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  @IsBoolean()
  cameraAllowed!: boolean;

  @IsBoolean()
  microphoneAllowed!: boolean;

  @IsBoolean()
  sendFamilyAudioAllowed!: boolean;

  @IsInt()
  @Min(0)
  version!: number;
}

export class JoinTicketDto {
  @IsIn(['WEB', 'ANDROID'])
  clientType!: 'WEB' | 'ANDROID';
}
