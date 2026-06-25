import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendThreadReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
