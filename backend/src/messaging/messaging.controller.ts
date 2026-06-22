import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { SearchUsersDto } from './dto/search-users.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartDirectConversationDto } from './dto/start-direct-conversation.dto';
import { MessagingService } from './messaging.service';

@Controller('messaging')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get('users/search')
  searchUsers(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchUsersDto) {
    return this.messagingService.searchUsers(user.sub, query.query);
  }

  @Get('users/mention-search')
  searchMentionableUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('query') query?: string,
    @Query('conversationId') conversationId?: string
  ) {
    return this.messagingService.searchMentionableUsers(user.sub, query || '', conversationId);
  }

  @Get('direct-conversations')
  listDirectConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.messagingService.listDirectConversations(user.sub);
  }

  @Post('direct-conversations')
  startDirectConversation(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartDirectConversationDto) {
    return this.messagingService.startDirectConversation(user.sub, dto.userId);
  }

  @Get('direct-conversations/:conversationId/messages')
  listMessages(@CurrentUser() user: AuthenticatedUser, @Param('conversationId') conversationId: string) {
    return this.messagingService.listMessages(user.sub, conversationId);
  }

  @Post('direct-conversations/:conversationId/messages')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Param('conversationId') conversationId: string, @Body() dto: SendMessageDto) {
    return this.messagingService.sendMessage(user.sub, conversationId, dto.content, dto.attachmentIds);
  }
}
