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
