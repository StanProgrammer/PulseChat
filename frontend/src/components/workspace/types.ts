import type { AttachmentInfo, DirectConversation, DirectMessage, MessageReaction, ThreadReply } from '../../api/messaging';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type RealtimeMessage = DirectMessage & {
  clientMessageId?: string;
  status?: 'sending' | 'sent' | 'failed';
  threadReplyCount?: number;
};

export type PendingFile = {
  id: string;
  file: File;
  previewUrl?: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  attachmentInfo?: AttachmentInfo;
};

export type SocketAck = {
  ok: boolean;
  message?: string;
};

export type ServerToClientEvents = {
  'socket:ready': (payload: { userId: string }) => void;
  'socket:error': (payload: { message: string }) => void;
  'message:new': (payload: { conversationId: string; message: DirectMessage; clientMessageId?: string }) => void;
  'message:updated': (payload: { conversationId: string; message: DirectMessage }) => void;
  'message:deleted': (payload: { conversationId: string; messageId: string }) => void;
  'message:reactions:updated': (payload: { conversationId: string; messageId: string; reactions: MessageReaction[] }) => void;
  'conversation:updated': (payload: { conversation: DirectConversation }) => void;
  'thread:reply:new': (payload: { reply: ThreadReply; replyCount: number }) => void;
  'thread:reply:deleted': (payload: { replyId: string; messageId: string; replyCount: number }) => void;
  'thread:unread:updated': (payload: { unreadCounts: Record<string, number> }) => void;
};

export type ClientToServerEvents = {
  'conversation:join': (payload: { conversationId: string }, callback?: (response: SocketAck) => void) => void;
  'conversation:leave': (payload: { conversationId: string }, callback?: (response: SocketAck) => void) => void;
  'message:send': (
    payload: { conversationId: string; content: string; clientMessageId: string; attachmentIds?: string[] },
    callback?: (response: SocketAck & { messageId?: string; clientMessageId?: string }) => void
  ) => void;
  'message:update': (
    payload: { messageId: string; content: string },
    callback?: (response: SocketAck & { messageId?: string }) => void
  ) => void;
  'message:delete': (
    payload: { messageId: string },
    callback?: (response: SocketAck & { messageId?: string }) => void
  ) => void;
  'message:reaction:toggle': (payload: { messageId: string; emoji: string }, callback?: (response: SocketAck) => void) => void;
  'thread:reply': (
    payload: { messageId: string; content: string; conversationId?: string },
    callback?: (response: SocketAck & { replyId?: string }) => void
  ) => void;
  'thread:reply:delete': (
    payload: { replyId: string },
    callback?: (response: SocketAck) => void
  ) => void;
  'thread:mark-read': (
    payload: { messageId: string },
    callback?: (response: SocketAck) => void
  ) => void;
};
