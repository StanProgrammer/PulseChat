import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { MessagingService } from '../messaging/messaging.service';

type AuthenticatedSocket = Socket & {
  data: {
    user?: AuthenticatedUser;
    joinedConversations?: Set<string>;
  };
};

type SendMessagePayload = {
  conversationId?: string;
  content?: string;
  clientMessageId?: string;
  attachmentIds?: string[];
};

@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGIN?.split(',').map((origin) => origin.trim()) || ['http://localhost:4173'],
    credentials: true
  }
})
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly messagingService: MessagingService
  ) {}

  handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.extractAccessToken(client);
      const user = this.authService.verifyAccessToken(token);

      client.data.user = user;
      client.data.joinedConversations = new Set();
      client.join(this.userRoom(user.sub));
      client.emit('socket:ready', { userId: user.sub });
    } catch (error) {
      client.emit('socket:error', { message: error instanceof Error ? error.message : 'Socket authentication failed.' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    client.data.joinedConversations?.clear();
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() payload: { conversationId?: string }) {
    const user = this.requireSocketUser(client);
    const conversationId = payload?.conversationId;

    if (!conversationId) {
      return { ok: false, message: 'Conversation id is required.' };
    }

    await this.messagingService.getDirectConversationForUser(user.sub, conversationId);
    client.join(this.conversationRoom(conversationId));
    client.data.joinedConversations?.add(conversationId);
    return { ok: true, conversationId };
  }

  @SubscribeMessage('conversation:leave')
  leaveConversation(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() payload: { conversationId?: string }) {
    if (payload?.conversationId) {
      client.leave(this.conversationRoom(payload.conversationId));
      client.data.joinedConversations?.delete(payload.conversationId);
    }

    return { ok: true };
  }

  @SubscribeMessage('message:send')
  async sendMessage(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() payload: SendMessagePayload) {
    const user = this.requireSocketUser(client);
    const conversationId = payload?.conversationId;
    const content = payload?.content || '';
    const attachmentIds = payload?.attachmentIds;

    if (!conversationId || (!content.trim() && (!attachmentIds || attachmentIds.length === 0))) {
      return { ok: false, message: 'Conversation id and message content or attachments are required.' };
    }

    try {
      const { message } = await this.messagingService.sendMessage(user.sub, conversationId, content, attachmentIds);
      const memberIds = await this.messagingService.getConversationMemberIds(user.sub, conversationId);

      this.server.to(this.conversationRoom(conversationId)).emit('message:new', {
        conversationId,
        message,
        clientMessageId: payload.clientMessageId
      });

      await Promise.all(
        memberIds.map(async (memberId) => {
          const conversation = await this.messagingService.getDirectConversationForUser(memberId, conversationId);
          this.server.to(this.userRoom(memberId)).emit('conversation:updated', { conversation });
        })
      );

      return { ok: true, messageId: message.id, clientMessageId: payload.clientMessageId };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to send message.' };
    }
  }

  @SubscribeMessage('message:update')
  async updateMessage(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() payload: { messageId?: string; content?: string }) {
    const user = this.requireSocketUser(client);
    const messageId = payload?.messageId;
    const content = payload?.content || '';

    if (!messageId || !content.trim()) {
      return { ok: false, message: 'Message id and content are required.' };
    }

    try {
      const { message } = await this.messagingService.updateMessage(user.sub, messageId, content);

      this.server.to(this.conversationRoom(message.conversationId)).emit('message:updated', {
        conversationId: message.conversationId,
        message
      });

      // Notify sidebar via conversation:updated
      const memberIds = await this.messagingService.getConversationMemberIds(user.sub, message.conversationId);
      await Promise.all(
        memberIds.map(async (memberId) => {
          const conversation = await this.messagingService.getDirectConversationForUser(memberId, message.conversationId);
          this.server.to(this.userRoom(memberId)).emit('conversation:updated', { conversation });
        })
      );

      return { ok: true, messageId: message.id };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to update message.' };
    }
  }

  @SubscribeMessage('message:delete')
  async deleteMessage(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() payload: { messageId?: string }) {
    const user = this.requireSocketUser(client);
    const messageId = payload?.messageId;

    if (!messageId) {
      return { ok: false, message: 'Message id is required.' };
    }

    try {
      const { deletedMessageId, conversationId } = await this.messagingService.deleteMessage(user.sub, messageId);

      this.server.to(this.conversationRoom(conversationId)).emit('message:deleted', {
        conversationId,
        messageId: deletedMessageId
      });

      return { ok: true, messageId: deletedMessageId };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to delete message.' };
    }
  }

  /* ── Thread reply socket events ── */

  @SubscribeMessage('thread:reply')
  async sendThreadReply(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() payload: { messageId?: string; content?: string; conversationId?: string }) {
    const user = this.requireSocketUser(client);
    const messageId = payload?.messageId;
    const content = payload?.content || '';

    if (!messageId || !content.trim()) {
      return { ok: false, message: 'Message id and content are required.' };
    }

    try {
      const { reply } = await this.messagingService.sendThreadReply(user.sub, messageId, content);

      const { count } = await this.messagingService.getThreadReplyCount(messageId);

      // Broadcast to conversation room
      this.server.to(this.conversationRoom(reply.conversationId)).emit('thread:reply:new', {
        reply,
        replyCount: count
      });

      return { ok: true, replyId: reply.id };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to send reply.' };
    }
  }

  @SubscribeMessage('thread:reply:delete')
  async deleteThreadReply(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() payload: { replyId?: string }) {
    const user = this.requireSocketUser(client);
    const replyId = payload?.replyId;

    if (!replyId) {
      return { ok: false, message: 'Reply id is required.' };
    }

    try {
      const result = await this.messagingService.deleteThreadReply(user.sub, replyId);

      this.server.to(this.conversationRoom(result.conversationId)).emit('thread:reply:deleted', {
        replyId: result.deletedReplyId,
        messageId: result.messageId,
        replyCount: result.replyCount
      });

      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to delete reply.' };
    }
  }

  @SubscribeMessage('thread:mark-read')
  async markThreadRead(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() payload: { messageId?: string }) {
    const user = this.requireSocketUser(client);
    const messageId = payload?.messageId;

    if (!messageId) {
      return { ok: false, message: 'Message id is required.' };
    }

    try {
      await this.messagingService.markThreadRead(user.sub, messageId);

      // Emit unread counts to user
      const { unreadCounts } = await this.messagingService.getUnreadThreadReplies(user.sub);
      this.server.to(this.userRoom(user.sub)).emit('thread:unread:updated', { unreadCounts });

      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Unable to mark thread as read.' };
    }
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() payload: unknown) {
    return { event: 'pong', data: payload };
  }

  private extractAccessToken(client: Socket) {
    const authToken = client.handshake.auth?.token;

    if (typeof authToken === 'string' && authToken) {
      return authToken;
    }

    const authorization = client.handshake.headers.authorization;

    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice(7);
    }

    throw new Error('Socket access token is missing.');
  }

  private requireSocketUser(client: AuthenticatedSocket) {
    if (!client.data.user) {
      throw new Error('Socket is not authenticated.');
    }

    return client.data.user;
  }

  private conversationRoom(conversationId: string) {
    return `conversation:${conversationId}`;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }
}
