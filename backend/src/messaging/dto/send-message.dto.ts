import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(10)
  attachmentIds?: string[];
}
