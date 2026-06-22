import type { AttachmentInfo, DirectConversation, DirectMessage } from '../../api/messaging';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type RealtimeMessage = DirectMessage & {
  clientMessageId?: string;
  status?: 'sending' | 'sent' | 'failed';
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
  'conversation:updated': (payload: { conversation: DirectConversation }) => void;
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
};
