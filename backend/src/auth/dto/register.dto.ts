import { IsEmail, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  confirmPassword!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  workspaceName!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  avatar?: string;
}
