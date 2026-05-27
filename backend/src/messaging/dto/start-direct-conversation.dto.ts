import { IsString, MinLength } from 'class-validator';

export class StartDirectConversationDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}
