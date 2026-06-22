import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMessageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content?: string;
}
