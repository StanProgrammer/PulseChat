import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  listDirectConversations,
  listDirectMessages,
  searchWorkspaceUsers,
  startDirectConversation,
  type AttachmentInfo,
  type DirectConversation,
  type Teammate
} from '../../api/messaging';
import type { User } from '../../types/auth';
import {
  createClientMessageId,
  markMessageFailed,
  mergeRealtimeMessage,
  mergeUpdatedMessage,
  removeDeletedMessage,
  sanitizeMessageHtml,
  upsertConversation
} from './messageUtils';
import type { ClientToServerEvents, RealtimeMessage, ServerToClientEvents, SocketStatus } from './types';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';
const SEARCH_DEBOUNCE_MS = 220;

export function useDirectMessaging(accessToken: string, user: User) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Teammate[]>([]);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isStartingConversation, setIsStartingConversation] = useState('');
  const [messages, setMessages] = useState<RealtimeMessage[]>([]);
  const [draftHtml, setDraftHtml] = useState('');
  const [draftText, setDraftText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [error, setError] = useState('');
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations]
  );

  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id || '';
  }, [activeConversation?.id]);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 8,
      reconnectionDelay: 600
    });

    socketRef.current = socket;
    setSocketStatus('connecting');

    socket.on('connect', () => {
      setSocketStatus('connected');
      setError('');
    });
    socket.on('disconnect', () => setSocketStatus('disconnected'));
    socket.on('connect_error', (requestError) => {
      setSocketStatus('error');
      setError(requestError.message || 'Realtime connection failed.');
    });
    socket.on('socket:error', (payload) => {
      setSocketStatus('error');
      setError(payload.message);
    });
    socket.on('message:new', ({ conversationId, message, clientMessageId }) => {
      if (conversationId === activeConversationIdRef.current) {
        setMessages((current) => mergeRealtimeMessage(current, message, clientMessageId));
      }
    });
    socket.on('message:updated', ({ conversationId, message }) => {
      if (conversationId === activeConversationIdRef.current) {
        setMessages((current) => mergeUpdatedMessage(current, message));
      }
    });
    socket.on('message:deleted', ({ conversationId, messageId }) => {
      if (conversationId === activeConversationIdRef.current) {
        setMessages((current) => removeDeletedMessage(current, messageId));
      }
    });
    socket.on('conversation:updated', ({ conversation }) => {
      setConversations((current) => upsertConversation(current, conversation));
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken]);

  useEffect(() => {
    let isActive = true;

    listDirectConversations(accessToken)
      .then((response) => {
        if (isActive) {
          setConversations(response.conversations);
          setActiveConversationId((current) => current || response.conversations[0]?.id || '');
        }
      })
      .catch((requestError: unknown) => {
        if (isActive) {
          setError(getErrorMessage(requestError, 'Unable to load direct messages.'));
        }
      });

    return () => {
      isActive = false;
    };
  }, [accessToken]);

  useEffect(() => {
    let isActive = true;
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timeoutId = window.setTimeout(() => {
      searchWorkspaceUsers(accessToken, trimmedQuery)
        .then((response) => {
          if (isActive) {
            setSearchResults(response.users);
            setError('');
          }
        })
        .catch((requestError: unknown) => {
          if (isActive) {
            setSearchResults([]);
            setError(getErrorMessage(requestError, 'Unable to search teammates.'));
          }
        })
        .finally(() => {
          if (isActive) {
            setIsSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, [accessToken, query]);

  useEffect(() => {
    let isActive = true;

    if (!activeConversation?.id) {
      setMessages([]);
      return;
    }

    listDirectMessages(accessToken, activeConversation.id)
      .then((response) => {
        if (isActive) {
          setMessages(response.messages);
        }
      })
      .catch((requestError: unknown) => {
        if (isActive) {
          setMessages([]);
          setError(getErrorMessage(requestError, 'Unable to load messages.'));
        }
      });

    return () => {
      isActive = false;
    };
  }, [accessToken, activeConversation?.id]);

  useEffect(() => {
    const socket = socketRef.current;

    if (!socket || !activeConversation?.id || socketStatus !== 'connected') {
      return;
    }

    const conversationId = activeConversation.id;
    socket.emit('conversation:join', { conversationId }, (response) => {
      if (!response?.ok) {
        setError(response?.message || 'Unable to join realtime conversation.');
      }
    });

    return () => {
      socket.emit('conversation:leave', { conversationId });
    };
  }, [activeConversation?.id, socketStatus]);

  const startConversation = useCallback(async (teammate: Teammate) => {
    setIsStartingConversation(teammate.id);
    setError('');

    try {
      const response = await startDirectConversation(accessToken, teammate.id);
      setConversations((current) => upsertConversation(current, response.conversation));
      setActiveConversationId(response.conversation.id);
      setQuery('');
      setSearchResults([]);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to start this direct message.'));
    } finally {
      setIsStartingConversation('');
    }
  }, [accessToken]);

  const updateDraft = useCallback((html: string, text: string) => {
    setDraftHtml(html);
    setDraftText(text);
  }, []);

  const updateMessage = useCallback((messageId: string, content: string, conversationId: string) => {
    const socket = socketRef.current;
    if (!socket || socketStatus !== 'connected') {
      setError('Realtime connection is offline. Reconnect before editing.');
      return;
    }

    // Optimistic update
    setMessages((current) =>
      current.map((msg) =>
        msg.id === messageId
          ? { ...msg, content, status: 'sending' as const }
          : msg
      )
    );

    socket.emit('message:update', { messageId, content }, (response) => {
      if (!response?.ok) {
        setMessages((current) => current.map((msg) =>
          msg.id === messageId ? { ...msg, status: 'failed' as const } : msg
        ));
        setError(response?.message || 'Unable to edit this message.');
      }
    });
  }, [socketStatus]);

  const deleteMessage = useCallback((messageId: string, conversationId: string) => {
    const socket = socketRef.current;
    if (!socket || socketStatus !== 'connected') {
      setError('Realtime connection is offline. Reconnect before deleting.');
      return;
    }

    // Stash for rollback, then optimistically remove
    let stashedMessage: RealtimeMessage | null = null;
    setMessages((current) => {
      const msg = current.find((m) => m.id === messageId);
      stashedMessage = msg || null;
      return current.filter((msg) => msg.id !== messageId);
    });

    socket.emit('message:delete', { messageId }, (response) => {
      if (!response?.ok) {
        if (stashedMessage) {
          setMessages((current) => {
            // Avoid re-adding if socket event already restored it
            if (current.some((m) => m.id === messageId)) return current;
            return [...current, stashedMessage!].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          });
        }
        setError(response?.message || 'Unable to delete this message.');
      }
    });
  }, [socketStatus]);

  const sendMessage = useCallback((event: FormEvent<HTMLFormElement>, options?: { attachmentIds?: string[]; pendingAttachments?: AttachmentInfo[] }) => {
    event.preventDefault();

    if (!activeConversation?.id || (!draftText.trim() && (!options?.attachmentIds || options.attachmentIds.length === 0))) {
      return;
    }

    const content = sanitizeMessageHtml(draftHtml);
    const clientMessageId = createClientMessageId();
    const timestamp = new Date().toISOString();
    const optimisticAttachments = options?.pendingAttachments || [];
    const optimisticMessage: RealtimeMessage = {
      id: clientMessageId,
      clientMessageId,
      content,
      createdAt: timestamp,
      updatedAt: timestamp,
      sender: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        workspaceName: user.workspaceName
      },
      status: 'sending',
      attachments: optimisticAttachments
    };

    setIsSending(true);
    setError('');
    setDraftHtml('');
    setDraftText('');
    setMessages((current) => [...current, optimisticMessage]);
    setConversations((current) => upsertConversation(current, {
      ...activeConversation,
      lastMessage: optimisticMessage,
      updatedAt: timestamp
    }));

    const socket = socketRef.current;

    if (!socket || socketStatus !== 'connected') {
      setMessages((current) => markMessageFailed(current, clientMessageId));
      setError('Realtime connection is offline. Reconnect before sending.');
      setIsSending(false);
      return;
    }

    socket.emit('message:send', {
      conversationId: activeConversation.id,
      content,
      clientMessageId,
      attachmentIds: options?.attachmentIds
    }, (response) => {
      setIsSending(false);

      if (!response?.ok) {
        setMessages((current) => markMessageFailed(current, clientMessageId));
        setError(response?.message || 'Unable to send this message.');
      }
    });
  }, [activeConversation, draftHtml, draftText, socketStatus, user]);

  return {
    activeConversation,
    conversations,
    draftHtml,
    draftText,
    error,
    isSearching,
    isSending,
    isStartingConversation,
    messages,
    query,
    searchResults,
    setActiveConversationId,
    setQuery,
    socketRef,
    socketStatus,
    startConversation,
    sendMessage,
    updateMessage,
    deleteMessage,
    updateDraft
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
