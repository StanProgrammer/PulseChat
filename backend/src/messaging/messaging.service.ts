import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConversationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const attachmentFields = {
  id: true,
  fileName: true,
  originalName: true,
  mimeType: true,
  size: true,
  url: true,
  publicId: true,
  resourceType: true,
  fileType: true,
  uploaderId: true,
  createdAt: true
} satisfies Prisma.AttachmentSelect;

const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  workspaceName: true
} satisfies Prisma.UserSelect;

const messageInclude = {
  sender: { select: userSummarySelect },
  attachments: { select: attachmentFields, orderBy: { createdAt: 'asc' as const } }
} satisfies Prisma.MessageInclude;

const conversationInclude = {
  members: {
    include: {
      user: { select: userSummarySelect }
    },
    orderBy: { joinedAt: 'asc' as const }
  },
  messages: {
    include: messageInclude,
    orderBy: { createdAt: 'desc' as const },
    take: 1
  }
} satisfies Prisma.ConversationInclude;

function normalizeMentionSearchQuery(query: string): string {
  return query
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService) {}

  async searchUsers(currentUserId: string, query: string) {
    const currentUser = await this.getCurrentUser(currentUserId);
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      // Return all workspace users (excluding self)
      const users = await this.prisma.user.findMany({
        where: {
          id: { not: currentUser.id },
          workspaceName: currentUser.workspaceName
        },
        select: userSummarySelect,
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        take: 12
      });

      return { users };
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

  /**
   * Search workspace users for @mentions, optionally scoped to a conversation's members.
   */
  async searchMentionableUsers(currentUserId: string, query: string, conversationId?: string) {
    const currentUser = await this.getCurrentUser(currentUserId);
    const trimmedQuery = normalizeMentionSearchQuery(query);

    // Base where: same workspace, exclude self
    const baseWhere: Prisma.UserWhereInput = {
      id: { not: currentUser.id },
      workspaceName: currentUser.workspaceName
    };

    // If scoped to a conversation, only include members of that conversation
    if (conversationId) {
      const memberIds = await this.getConversationMemberIds(currentUserId, conversationId);
      baseWhere.id = { not: currentUser.id, in: memberIds };
    }

    // Add name filter if there's a query
    if (trimmedQuery) {
      baseWhere.OR = [
        { name: { contains: trimmedQuery, mode: 'insensitive' } },
        { email: { contains: trimmedQuery, mode: 'insensitive' } }
      ];
    }

    const users = await this.prisma.user.findMany({
      where: baseWhere,
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
      include: messageInclude,
      orderBy: { createdAt: 'asc' },
      take: 80
    });

    return { messages: messages.map((message) => this.toMessage(message)) };
  }



  async updateMessage(currentUserId: string, messageId: string, content: string) {
    const trimmedContent = content.trim();
    const plainContent = trimmedContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

    if (!plainContent) {
      throw new BadRequestException('Message cannot be empty.');
    }

    if (trimmedContent.length > 4000) {
      throw new BadRequestException('Message is too long.');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, conversationId: true }
    });

    if (!message) {
      throw new NotFoundException('Message could not be found.');
    }

    if (message.senderId !== currentUserId) {
      throw new ForbiddenException('You can only edit your own messages.');
    }

    const updatedMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: { content: trimmedContent },
      include: messageInclude
    });

    await this.prisma.conversation.update({
      where: { id: message.conversationId },
      data: { updatedAt: new Date() }
    });

    return { message: this.toMessage(updatedMessage) };
  }

  async deleteMessage(currentUserId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, conversationId: true }
    });

    if (!message) {
      throw new NotFoundException('Message could not be found.');
    }

    if (message.senderId !== currentUserId) {
      throw new ForbiddenException('You can only delete your own messages.');
    }

    await this.prisma.message.delete({
      where: { id: messageId }
    });

    await this.prisma.conversation.update({
      where: { id: message.conversationId },
      data: { updatedAt: new Date() }
    });

    return { deletedMessageId: messageId, conversationId: message.conversationId };
  }

  async sendMessage(currentUserId: string, conversationId: string, content: string, attachmentIds?: string[]) {
    await this.ensureConversationMember(currentUserId, conversationId);

    const trimmedContent = content.trim();
    const plainContent = trimmedContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    const uniqueAttachmentIds = [...new Set(attachmentIds ?? [])];

    if (!plainContent && uniqueAttachmentIds.length === 0) {
      throw new BadRequestException('Message cannot be empty.');
    }

    if (trimmedContent.length > 4000) {
      throw new BadRequestException('Message is too long.');
    }

    if (uniqueAttachmentIds.length > 10) {
      throw new BadRequestException('You can attach up to 10 files to a message.');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      if (uniqueAttachmentIds.length > 0) {
        const claimableAttachments = await tx.attachment.findMany({
          where: {
            id: { in: uniqueAttachmentIds },
            uploaderId: currentUserId,
            messageId: null
          },
          select: { id: true }
        });

        if (claimableAttachments.length !== uniqueAttachmentIds.length) {
          throw new BadRequestException('One or more attachments could not be used for this message.');
        }
      }

      const createdMessage = await tx.message.create({
        data: {
          conversationId,
          senderId: currentUserId,
          content: trimmedContent
        }
      });

      if (uniqueAttachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: {
            id: { in: uniqueAttachmentIds },
            uploaderId: currentUserId,
            messageId: null
          },
          data: { messageId: createdMessage.id }
        });
      }

      return tx.message.findUniqueOrThrow({
        where: { id: createdMessage.id },
        include: messageInclude
      });
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

  /* ── Thread replies ── */

  async sendThreadReply(currentUserId: string, messageId: string, content: string) {
    const trimmedContent = content.trim();
    const plainContent = trimmedContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

    if (!plainContent) {
      throw new BadRequestException('Reply cannot be empty.');
    }

    if (trimmedContent.length > 4000) {
      throw new BadRequestException('Reply is too long.');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, senderId: true }
    });

    if (!message) {
      throw new NotFoundException('Message could not be found.');
    }

    await this.ensureConversationMember(currentUserId, message.conversationId);

    const reply = await this.prisma.threadReply.create({
      data: {
        messageId,
        senderId: currentUserId,
        conversationId: message.conversationId,
        content: trimmedContent
      },
      include: {
        sender: { select: userSummarySelect }
      }
    });

    // Update conversation timestamp
    await this.prisma.conversation.update({
      where: { id: message.conversationId },
      data: { updatedAt: new Date() }
    });

    // Auto-mark as read by the sender
    await this.prisma.threadReplyRead.upsert({
      where: {
        userId_messageId: {
          userId: currentUserId,
          messageId
        }
      },
      update: { lastReadAt: new Date() },
      create: {
        userId: currentUserId,
        messageId,
        lastReadAt: new Date()
      }
    });

    return {
      reply: {
        id: reply.id,
        content: reply.content,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt,
        sender: reply.sender,
        messageId: reply.messageId,
        conversationId: reply.conversationId
      }
    };
  }

  async listThreadReplies(currentUserId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true }
    });

    if (!message) {
      throw new NotFoundException('Message could not be found.');
    }

    await this.ensureConversationMember(currentUserId, message.conversationId);

    const replies = await this.prisma.threadReply.findMany({
      where: { messageId },
      include: {
        sender: { select: userSummarySelect }
      },
      orderBy: { createdAt: 'asc' },
      take: 80
    });

    return {
      replies: replies.map((reply) => ({
        id: reply.id,
        content: reply.content,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt,
        sender: reply.sender,
        messageId: reply.messageId,
        conversationId: reply.conversationId
      }))
    };
  }

  async getThreadReplyCount(messageId: string) {
    const count = await this.prisma.threadReply.count({
      where: { messageId }
    });

    return { count };
  }

  async getThreadReplyCountsForConversation(currentUserId: string, conversationId: string) {
    await this.ensureConversationMember(currentUserId, conversationId);

    // Get all messages in this conversation
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      select: { id: true }
    });

    const messageIds = messages.map((m) => m.id);

    if (messageIds.length === 0) {
      return { replyCounts: {} };
    }

    // Get reply counts grouped by message
    const groups = await this.prisma.threadReply.groupBy({
      by: ['messageId'],
      where: {
        messageId: { in: messageIds }
      },
      _count: { id: true }
    });

    const replyCounts: Record<string, number> = {};
    for (const group of groups) {
      replyCounts[group.messageId] = group._count.id;
    }

    return { replyCounts };
  }

  async deleteThreadReply(currentUserId: string, replyId: string) {
    const reply = await this.prisma.threadReply.findUnique({
      where: { id: replyId },
      select: { id: true, senderId: true, messageId: true, conversationId: true }
    });

    if (!reply) {
      throw new NotFoundException('Thread reply could not be found.');
    }

    if (reply.senderId !== currentUserId) {
      throw new ForbiddenException('You can only delete your own replies.');
    }

    await this.prisma.threadReply.delete({ where: { id: replyId } });

    // Get updated count
    const { count } = await this.getThreadReplyCount(reply.messageId);

    return {
      deletedReplyId: replyId,
      messageId: reply.messageId,
      conversationId: reply.conversationId,
      replyCount: count
    };
  }

  async getUnreadThreadReplies(currentUserId: string, conversationId?: string) {
    // Get all messages with their latest thread reply time and user's last read time
    const where: Prisma.ThreadReplyWhereInput = {};

    if (conversationId) {
      await this.ensureConversationMember(currentUserId, conversationId);
      where.conversationId = conversationId;
    }

    // Get all read records for this user
    const reads = await this.prisma.threadReplyRead.findMany({
      where: { userId: currentUserId },
      select: { messageId: true, lastReadAt: true }
    });

    const readMap = new Map(reads.map((r) => [r.messageId, r.lastReadAt]));

    // Get all thread replies grouped by message, finding the latest per message
    const replies = await this.prisma.threadReply.groupBy({
      by: ['messageId'],
      where,
      _max: { createdAt: true },
      _count: { id: true }
    });

    const unreadCounts: Record<string, number> = {};

    for (const group of replies) {
      const lastRead = readMap.get(group.messageId);
      if (!lastRead || (group._max.createdAt && group._max.createdAt > lastRead)) {
        // Count how many replies are unread
        if (lastRead) {
          const unreadCount = await this.prisma.threadReply.count({
            where: {
              messageId: group.messageId,
              createdAt: { gt: lastRead }
            }
          });
          if (unreadCount > 0) {
            unreadCounts[group.messageId] = unreadCount;
          }
        } else {
          // Never read - all replies are unread
          unreadCounts[group.messageId] = group._count.id;
        }
      }
    }

    return { unreadCounts };
  }

  async markThreadRead(currentUserId: string, messageId: string) {
    await this.prisma.threadReplyRead.upsert({
      where: {
        userId_messageId: {
          userId: currentUserId,
          messageId
        }
      },
      update: { lastReadAt: new Date() },
      create: {
        userId: currentUserId,
        messageId,
        lastReadAt: new Date()
      }
    });

    return { ok: true };
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

  private toMessage(message: MessageWithAttachments) {
    return {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      sender: message.sender,
      attachments: message.attachments,
      conversationId: message.conversationId
    };
  }

}

type ConversationWithMembers = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

type MessageWithAttachments = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;
