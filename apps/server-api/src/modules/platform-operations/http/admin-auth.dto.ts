import { IsString, Length, MaxLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @Length(3, 320)
  identifier!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}
