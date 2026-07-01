import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { SearchUsersDto } from './dto/search-users.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartDirectConversationDto } from './dto/start-direct-conversation.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { SendThreadReplyDto } from './dto/send-thread-reply.dto';
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

  @Patch('direct-conversations/:conversationId/messages/:messageId')
  updateMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') _conversationId: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto
  ) {
    return this.messagingService.updateMessage(user.sub, messageId, dto.content || '');
  }

  @Delete('direct-conversations/:conversationId/messages/:messageId')
  deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') _conversationId: string,
    @Param('messageId') messageId: string
  ) {
    return this.messagingService.deleteMessage(user.sub, messageId);
  }

  @Post('messages/:messageId/reactions')
  toggleMessageReaction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body('emoji') emoji: string
  ) {
    return this.messagingService.toggleMessageReaction(user.sub, messageId, emoji || '');
  }

  /* ── Thread replies ── */

  @Get('messages/:messageId/thread-replies')
  listThreadReplies(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.messagingService.listThreadReplies(user.sub, messageId);
  }

  @Delete('messages/:messageId/thread-replies/:replyId')
  deleteThreadReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') _messageId: string,
    @Param('replyId') replyId: string
  ) {
    return this.messagingService.deleteThreadReply(user.sub, replyId);
  }

  @Post('messages/:messageId/thread-replies')
  sendThreadReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId') messageId: string,
    @Body() dto: SendThreadReplyDto
  ) {
    return this.messagingService.sendThreadReply(user.sub, messageId, dto.content);
  }

  @Get('thread-replies/unread')
  getUnreadThreadReplies(
    @CurrentUser() user: AuthenticatedUser,
    @Query('conversationId') conversationId?: string
  ) {
    return this.messagingService.getUnreadThreadReplies(user.sub, conversationId);
  }

  @Post('messages/:messageId/thread-replies/read')
  markThreadRead(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.messagingService.markThreadRead(user.sub, messageId);
  }

  @Get('messages/:messageId')
  getMessage(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.messagingService.getMessage(user.sub, messageId);
  }

  @Get('messages/:messageId/thread-reply-count')
  getThreadReplyCount(@Param('messageId') messageId: string) {
    return this.messagingService.getThreadReplyCount(messageId);
  }

  @Get('conversations/:conversationId/search')
  searchMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query('query') query?: string
  ) {
    return this.messagingService.searchMessages(user.sub, conversationId, query || '');
  }

  @Get('thread-reply-counts/:conversationId')
  getThreadReplyCounts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string
  ) {
    return this.messagingService.getThreadReplyCountsForConversation(user.sub, conversationId);
  }
}
