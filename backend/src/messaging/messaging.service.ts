import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConversationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  workspaceName: true
} satisfies Prisma.UserSelect;

const conversationInclude = {
  members: {
    include: {
      user: { select: userSummarySelect }
    },
    orderBy: { joinedAt: 'asc' as const }
  },
  messages: {
    include: {
      sender: { select: userSummarySelect }
    },
    orderBy: { createdAt: 'desc' as const },
    take: 1
  }
} satisfies Prisma.ConversationInclude;

@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService) {}

  async searchUsers(currentUserId: string, query: string) {
    const currentUser = await this.getCurrentUser(currentUserId);
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return { users: [] };
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { not: currentUser.id },
        workspaceName: currentUser.workspaceName,
        name: { contains: trimmedQuery, mode: 'insensitive' }
      },
      select: userSummarySelect,
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      take: 12
    });

    return { users };
  }

  async listDirectConversations(currentUserId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.DIRECT,
        members: { some: { userId: currentUserId } }
      },
      include: conversationInclude,
      orderBy: { updatedAt: 'desc' },
      take: 30
    });

    return {
      conversations: conversations.map((conversation) => this.toDirectConversation(conversation, currentUserId))
    };
  }

  async startDirectConversation(currentUserId: string, otherUserId: string) {
    if (currentUserId === otherUserId) {
      throw new BadRequestException('Choose a teammate to start a DM.');
    }

    const [currentUser, otherUser] = await Promise.all([
      this.getCurrentUser(currentUserId),
      this.prisma.user.findUnique({ where: { id: otherUserId }, select: userSummarySelect })
    ]);

    if (!otherUser) {
      throw new NotFoundException('This teammate could not be found.');
    }

    if (currentUser.workspaceName !== otherUser.workspaceName) {
      throw new ForbiddenException('Direct messages are limited to your workspace.');
    }

    const existingConversation = await this.findExistingDirectConversation(currentUserId, otherUserId);

    if (existingConversation) {
      return { conversation: this.toDirectConversation(existingConversation, currentUserId) };
    }

    const conversation = await this.prisma.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        members: {
          create: [{ userId: currentUserId }, { userId: otherUserId }]
        }
      },
      include: conversationInclude
    });

    return { conversation: this.toDirectConversation(conversation, currentUserId) };
  }

  async listMessages(currentUserId: string, conversationId: string) {
    await this.ensureConversationMember(currentUserId, conversationId);

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      include: {
        sender: { select: userSummarySelect }
      },
      orderBy: { createdAt: 'asc' },
      take: 80
    });

    return { messages: messages.map((message) => this.toMessage(message)) };
  }

  async sendMessage(currentUserId: string, conversationId: string, content: string) {
    await this.ensureConversationMember(currentUserId, conversationId);

    const trimmedContent = content.trim();
    const plainContent = trimmedContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

    if (!plainContent) {
      throw new BadRequestException('Message cannot be empty.');
    }

    if (trimmedContent.length > 4000) {
      throw new BadRequestException('Message is too long.');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: currentUserId,
        content: trimmedContent
      },
      include: {
        sender: { select: userSummarySelect }
      }
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });

    return { message: this.toMessage(message) };
  }

  async getConversationMemberIds(currentUserId: string, conversationId: string) {
    await this.ensureConversationMember(currentUserId, conversationId);

    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true }
    });

    return members.map((member) => member.userId);
  }

  async getDirectConversationForUser(userId: string, conversationId: string) {
    await this.ensureConversationMember(userId, conversationId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: conversationInclude
    });

    if (!conversation) {
      throw new NotFoundException('Conversation could not be found.');
    }

    return this.toDirectConversation(conversation, userId);
  }

  private async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userSummarySelect
    });

    if (!user) {
      throw new NotFoundException('Your account could not be found.');
    }

    return user;
  }

  private async findExistingDirectConversation(currentUserId: string, otherUserId: string) {
    const candidates = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.DIRECT,
        members: {
          every: {
            userId: { in: [currentUserId, otherUserId] }
          },
          some: { userId: currentUserId }
        }
      },
      include: conversationInclude,
      take: 10
    });

    return candidates.find(
      (conversation) =>
        conversation.members.length === 2 &&
        conversation.members.some((member) => member.userId === otherUserId)
    );
  }

  private async ensureConversationMember(userId: string, conversationId: string) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId
        }
      }
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this conversation.');
    }
  }

  private toDirectConversation(conversation: ConversationWithMembers, currentUserId: string) {
    const otherMember = conversation.members.find((member) => member.userId !== currentUserId);
    const lastMessage = conversation.messages[0];

    return {
      id: conversation.id,
      type: conversation.type,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      participant: otherMember?.user ?? null,
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            content: lastMessage.content,
            createdAt: lastMessage.createdAt,
            sender: lastMessage.sender
          }
        : null
    };
  }

  private toMessage(message: MessageWithSender) {
    return {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      sender: message.sender
    };
  }

}

type ConversationWithMembers = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

type MessageWithSender = Prisma.MessageGetPayload<{
  include: {
    sender: {
      select: typeof userSummarySelect;
    };
  };
}>;
