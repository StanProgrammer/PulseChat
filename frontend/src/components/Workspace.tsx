import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { io, Socket } from 'socket.io-client';
import {
  DirectConversation,
  DirectMessage,
  Teammate,
  listDirectConversations,
  listDirectMessages,
  searchWorkspaceUsers,
  startDirectConversation
} from '../api/messaging';
import type { User } from '../types/auth';
import BrandLockup from './BrandLockup';

type WorkspaceProps = {
  user: User;
  accessToken: string;
  isLoading: boolean;
  onLogout: () => Promise<void>;
};

type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type RealtimeMessage = DirectMessage & {
  clientMessageId?: string;
  status?: 'sending' | 'sent' | 'failed';
};

type ServerToClientEvents = {
  'socket:ready': (payload: { userId: string }) => void;
  'socket:error': (payload: { message: string }) => void;
  'message:new': (payload: { conversationId: string; message: DirectMessage; clientMessageId?: string }) => void;
  'conversation:updated': (payload: { conversation: DirectConversation }) => void;
};

type ClientToServerEvents = {
  'conversation:join': (payload: { conversationId: string }, callback?: (response: SocketAck) => void) => void;
  'conversation:leave': (payload: { conversationId: string }, callback?: (response: SocketAck) => void) => void;
  'message:send': (
    payload: { conversationId: string; content: string; clientMessageId: string },
    callback?: (response: SocketAck & { messageId?: string; clientMessageId?: string }) => void
  ) => void;
};

type SocketAck = {
  ok: boolean;
  message?: string;
};

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';
const TEXT_FORMAT_OPTIONS = [
  { label: 'B', title: 'Bold', command: 'bold', styleClass: 'bold' },
  { label: 'I', title: 'Italic', command: 'italic', styleClass: 'italic' },
  { label: 'U', title: 'Underline', command: 'underline', styleClass: 'underline' },
  { label: 'S', title: 'Strikethrough', command: 'strikeThrough', styleClass: 'strikethrough' },
  { label: 'UL', title: 'Bulleted list', command: 'insertUnorderedList', styleClass: 'unordered-list' },
  { label: 'OL', title: 'Numbered list', command: 'insertOrderedList', styleClass: 'ordered-list' }
] as const;
const LINK_FORMAT_OPTION = { label: 'Link', title: 'Insert link' };
const EMPTY_EDITOR_HTML = '';
const MESSAGE_HTML_TAGS = ['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'span'];

function Workspace({ user, accessToken, isLoading, onLogout }: WorkspaceProps) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Teammate[]>([]);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isStarting, setIsStarting] = useState('');
  const [messages, setMessages] = useState<RealtimeMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState(EMPTY_EDITOR_HTML);
  const [messageDraftText, setMessageDraftText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [error, setError] = useState('');
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const initials = getInitials(user.name);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0];
  const activeParticipant = activeConversation?.participant ?? null;

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

    socket.on('disconnect', () => {
      setSocketStatus('disconnected');
    });

    socket.on('connect_error', (requestError) => {
      setSocketStatus('error');
      setError(requestError.message || 'Realtime connection failed.');
    });

    socket.on('socket:error', (payload) => {
      setSocketStatus('error');
      setError(payload.message);
    });

    socket.on('message:new', ({ conversationId, message, clientMessageId }) => {
      setMessages((current) => {
        if (conversationId !== activeConversationIdRef.current) {
          return current;
        }

        return mergeRealtimeMessage(current, message, clientMessageId);
      });
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

  const activeConversationIdRef = useRef(activeConversationId);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    let isMounted = true;

    const loadConversations = async () => {
      try {
        const response = await listDirectConversations(accessToken);

        if (isMounted) {
          setConversations(response.conversations);
          setActiveConversationId((current) => current || response.conversations[0]?.id || '');
        }
      } catch (requestError) {
        if (isMounted) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load direct messages.');
        }
      }
    };

    if (accessToken) {
      loadConversations();
    }

    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  useEffect(() => {
    let isMounted = true;
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await searchWorkspaceUsers(accessToken, trimmedQuery);

        if (isMounted) {
          setSearchResults(response.users);
          setError('');
        }
      } catch (requestError) {
        if (isMounted) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to search teammates.');
          setSearchResults([]);
        }
      } finally {
        if (isMounted) {
          setIsSearching(false);
        }
      }
    }, 220);

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
    };
  }, [accessToken, query]);

  useEffect(() => {
    let isMounted = true;

    const loadMessages = async () => {
      if (!activeConversation?.id) {
        setMessages([]);
        return;
      }

      try {
        const response = await listDirectMessages(accessToken, activeConversation.id);

        if (isMounted) {
          setMessages(response.messages);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load messages.');
          setMessages([]);
        }
      }
    };

    loadMessages();

    return () => {
      isMounted = false;
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

  const handleStartDm = async (teammate: Teammate) => {
    setIsStarting(teammate.id);
    setError('');

    try {
      const response = await startDirectConversation(accessToken, teammate.id);
      setConversations((current) => upsertConversation(current, response.conversation));
      setActiveConversationId(response.conversation.id);
      setQuery('');
      setSearchResults([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to start this direct message.');
    } finally {
      setIsStarting('');
    }
  };

  const handleComposerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeConversation?.id || !messageDraftText.trim()) {
      return;
    }

    const content = sanitizeMessageHtml(messageDraft);
    const clientMessageId = createClientMessageId();
    const optimisticMessage: RealtimeMessage = {
      id: clientMessageId,
      clientMessageId,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sender: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        workspaceName: user.workspaceName
      },
      status: 'sending'
    };

    setIsSending(true);
    setError('');
    setMessageDraft(EMPTY_EDITOR_HTML);
    setMessageDraftText('');
    setMessages((current) => [...current, optimisticMessage]);
    setConversations((current) =>
      upsertConversation(current, {
        ...activeConversation,
        lastMessage: optimisticMessage,
        updatedAt: optimisticMessage.createdAt
      })
    );

    const socket = socketRef.current;

    if (!socket || socketStatus !== 'connected') {
      setMessages((current) => markMessageFailed(current, clientMessageId));
      setError('Realtime connection is offline. Reconnect before sending.');
      setIsSending(false);
      return;
    }

    socket.emit(
      'message:send',
      {
        conversationId: activeConversation.id,
        content,
        clientMessageId
      },
      (response) => {
        setIsSending(false);

        if (!response?.ok) {
          setMessages((current) => markMessageFailed(current, clientMessageId));
          setError(response?.message || 'Unable to send this message.');
        }
      }
    );
  };

  return (
    <main className="workspace-shell min-h-screen bg-[#eef1f4] text-[#17191c]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="workspace-sidebar border-r border-white/10 bg-[#18242d] text-white lg:sticky lg:top-0 lg:h-screen">
          <div className="flex h-full flex-col">
            <div className="border-b border-white/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <BrandLockup inverted />
                <button className="workspace-icon-button border-white/10 bg-white/8 text-white hover:bg-white/14" title="Start direct message" type="button">
                  +
                </button>
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-white/8 p-3 shadow-lg shadow-black/10">
                <p className="truncate text-sm font-black">{user.workspaceName}</p>
                <p className="mt-1 text-xs font-semibold text-white/52">Direct messages only</p>
              </div>
            </div>

            <div className="scrollbar-soft flex-1 overflow-y-auto px-3 py-4">
              <label className="dm-search-field">
                <span>Find teammate</span>
                <input
                  autoComplete="off"
                  name="dm-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name"
                  type="search"
                  value={query}
                />
              </label>

              <SidebarSection title={query.trim() ? 'Search results' : 'Recent DMs'}>
                {query.trim() ? (
                  <SearchResults isLoading={isSearching} isStarting={isStarting} onStartDm={handleStartDm} results={searchResults} />
                ) : (
                  <ConversationList activeConversationId={activeConversation?.id} conversations={conversations} onSelect={setActiveConversationId} />
                )}
              </SidebarSection>
            </div>

            <div className="border-t border-white/10 p-3">
              <div className="account-strip">
                <Avatar initials={initials} tone="light" status="online" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black">{user.name}</p>
                  <p className="truncate text-xs font-semibold text-white/52">{user.email}</p>
                </div>
                <button className="workspace-icon-button border-white/10 bg-white/8 text-white hover:bg-white/14" disabled={isLoading} onClick={onLogout} title="Sign out" type="button">
                  {isLoading ? '...' : 'out'}
                </button>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex h-screen min-w-0 flex-col overflow-hidden">
          <header className="workspace-header sticky top-0 z-20 border-b border-[#d9dee4] bg-white/86 backdrop-blur-xl">
            <div className="flex min-h-[76px] flex-col gap-3 px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[#707984]">
                  <span className="h-2 w-2 rounded-full bg-[#2eb67d] shadow-[0_0_0_4px_rgba(46,182,125,0.13)]" />
                  {user.workspaceName}
                </div>
                <h1 className="mt-1 truncate text-2xl font-black text-[#17191c]">
                  {activeParticipant ? activeParticipant.name : 'Start a direct message'}
                </h1>
                <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-[#606975]">
                  {activeParticipant ? `Private conversation with ${activeParticipant.email}` : 'Search for someone in your workspace to open a 1:1 chat.'}
                </p>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="workspace-search">
                  <span className="font-black text-[#4a154b]">S</span>
                  <span className="truncate">Search same-workspace teammates</span>
                  <kbd>DM</kbd>
                </div>
                <Avatar initials={initials} />
              </div>
            </div>
          </header>

          <div className="chat-main min-w-0 flex-1 px-4 py-5 sm:px-6">
            <div className="conversation-panel animate-workspace-in">
              {error && <p className="dm-error">{error}</p>}

              {activeParticipant ? (
                <DirectConversationPanel
                  draft={messageDraft}
                  draftText={messageDraftText}
                  isSending={isSending}
                  messages={messages}
                  onDraftChange={(html, text) => {
                    setMessageDraft(html);
                    setMessageDraftText(text);
                  }}
                  onSubmit={handleComposerSubmit}
                  participant={activeParticipant}
                  socketStatus={socketStatus}
                  user={user}
                />
              ) : (
                <EmptyDirectState hasQuery={Boolean(query.trim())} />
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SearchResults({
  results,
  isLoading,
  isStarting,
  onStartDm
}: {
  results: Teammate[];
  isLoading: boolean;
  isStarting: string;
  onStartDm: (teammate: Teammate) => void;
}) {
  if (isLoading) {
    return <p className="sidebar-empty">Searching...</p>;
  }

  if (!results.length) {
    return <p className="sidebar-empty">No matching teammate in this workspace.</p>;
  }

  return (
    <>
      {results.map((person) => (
        <button className="dm-row" disabled={Boolean(isStarting)} key={person.id} onClick={() => onStartDm(person)} type="button">
          <Avatar initials={getInitials(person.name)} size="sm" status="online" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black">{person.name}</span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-white/42">{person.email}</span>
          </span>
          <span className="dm-start-chip">{isStarting === person.id ? '...' : 'DM'}</span>
        </button>
      ))}
    </>
  );
}

function ConversationList({
  conversations,
  activeConversationId,
  onSelect
}: {
  conversations: DirectConversation[];
  activeConversationId?: string;
  onSelect: (conversationId: string) => void;
}) {
  if (!conversations.length) {
    return <p className="sidebar-empty">Search for a teammate to start your first DM.</p>;
  }

  return (
    <>
      {conversations.map((conversation) => {
        const participant = conversation.participant;

        if (!participant) {
          return null;
        }

        return (
          <button className={`dm-row ${activeConversationId === conversation.id ? 'dm-row-active' : ''}`} key={conversation.id} onClick={() => onSelect(conversation.id)} type="button">
            <Avatar initials={getInitials(participant.name)} size="sm" status="online" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-black">{participant.name}</span>
              <span className="mt-0.5 block truncate text-xs font-semibold text-white/42">{conversation.lastMessage ? formatMessagePreview(conversation.lastMessage.content) : 'No messages yet'}</span>
            </span>
          </button>
        );
      })}
    </>
  );
}

function DirectConversationPanel({
  participant,
  user,
  messages,
  draft,
  draftText,
  isSending,
  socketStatus,
  onDraftChange,
  onSubmit
}: {
  participant: Teammate;
  user: User;
  messages: RealtimeMessage[];
  draft: string;
  draftText: string;
  isSending: boolean;
  socketStatus: SocketStatus;
  onDraftChange: (html: string, text: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const linkTextInputRef = useRef<HTMLInputElement | null>(null);
  const [activeMarks, setActiveMarks] = useState<Record<TextFormatCommand, boolean>>({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    insertUnorderedList: false,
    insertOrderedList: false
  });
  const [isLinkPopoverOpen, setIsLinkPopoverOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ text: '', url: '', error: '' });

  useEffect(() => {
    const editor = editorRef.current;

    if (!editor || draft || editor.innerHTML === '') {
      return;
    }

    editor.innerHTML = '';
  }, [draft]);

  useEffect(() => {
    const updateActiveMarks = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();

      if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) {
        return;
      }

      setActiveMarks(getActiveEditorCommands());
    };

    document.addEventListener('selectionchange', updateActiveMarks);
    return () => document.removeEventListener('selectionchange', updateActiveMarks);
  }, []);

  const syncEditorDraft = () => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    onDraftChange(sanitizeMessageHtml(editor.innerHTML), editor.textContent || '');
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    const content = html ? sanitizeMessageHtml(html) : escapeHtml(text).replace(/\r?\n/g, '<br>');

    document.execCommand('insertHTML', false, content);
    syncEditorDraft();
  };

  const openLinkPopover = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor) {
      return;
    }

    editor.focus();

    if (!selection || !selection.rangeCount) {
      const fallbackRange = document.createRange();
      fallbackRange.selectNodeContents(editor);
      fallbackRange.collapse(false);
      savedSelectionRef.current = fallbackRange;
      setLinkDraft({ text: '', url: '', error: '' });
      setIsLinkPopoverOpen(true);
      window.requestAnimationFrame(() => linkTextInputRef.current?.focus());
      return;
    }

    const range = selection.getRangeAt(0);
    let savedRange = range.cloneRange();
    let selectedText = selection.toString();

    if (!editor.contains(range.commonAncestorContainer)) {
      savedRange = document.createRange();
      savedRange.selectNodeContents(editor);
      savedRange.collapse(false);
      selectedText = '';
    }

    const activeLink = findClosestLink(selection.anchorNode, editor);

    if (activeLink && !selectedText) {
      savedRange = document.createRange();
      savedRange.selectNode(activeLink);
      selectedText = activeLink.textContent || '';
    }

    savedSelectionRef.current = savedRange;
    setLinkDraft({
      text: selectedText || activeLink?.textContent || '',
      url: activeLink?.getAttribute('href') || '',
      error: ''
    });
    setIsLinkPopoverOpen(true);
    window.requestAnimationFrame(() => linkTextInputRef.current?.focus());
  };

  const closeLinkPopover = () => {
    setIsLinkPopoverOpen(false);
    setLinkDraft({ text: '', url: '', error: '' });
    editorRef.current?.focus();
  };

  const insertLink = () => {
    const href = normalizeLinkUrl(linkDraft.url);

    if (!href) {
      setLinkDraft((current) => ({ ...current, error: 'Enter a valid http, https, mailto, or tel link.' }));
      return;
    }

    const text = linkDraft.text.trim() || href;
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection) {
      return;
    }

    editor.focus();
    selection.removeAllRanges();

    if (savedSelectionRef.current) {
      selection.addRange(savedSelectionRef.current);
    }

    document.execCommand('insertHTML', false, createLinkHtml(text, href));
    syncEditorDraft();
    closeLinkPopover();
  };

  const handleLinkPopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLinkPopover();
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      insertLink();
    }
  };

  return (
    <>
      <div className="conversation-hero">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar initials={getInitials(participant.name)} status="online" />
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#707984]">Direct message</p>
            <h2 className="mt-1 truncate text-xl font-black">{participant.name}</h2>
            <p className="mt-1 truncate text-sm font-semibold text-[#606975]">{participant.email}</p>
          </div>
        </div>
        <span className="channel-meta-pill">Same workspace</span>
      </div>

      <div className="conversation-stream">
        <DateDivider label="Today" />
        {messages.length ? (
          messages.map((message, index) => {
            const isOwn = message.sender.id === user.id;

            return (
              <article className={`message-card ${isOwn ? 'message-card-own' : ''}`} key={message.id} style={{ animationDelay: `${index * 55}ms` }}>
                <Avatar initials={getInitials(message.sender.name)} status={isOwn ? 'online' : undefined} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="font-black">{isOwn ? 'You' : message.sender.name}</h3>
                    <span className="text-xs font-bold text-[#8a939d]">{formatMessageTime(message.createdAt)}</span>
                    {message.status && <span className={`message-status message-status-${message.status}`}>{message.status}</span>}
                  </div>
                  <div className="message-content mt-2 text-[0.95rem] leading-7 text-[#343940]" dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(message.content) }} />
                </div>
              </article>
            );
          })
        ) : (
          <div className="dm-thread-empty">
            <p>No messages yet.</p>
            <span>Send the first note to start the conversation.</span>
          </div>
        )}
      </div>

      <form className="composer-shell" onSubmit={onSubmit}>
        <div className="dm-composer-input">
          <div
            aria-label={`Message ${participant.name}`}
            className="dm-composer-editor"
            contentEditable
            data-placeholder={`Message ${participant.name}`}
            onInput={syncEditorDraft}
            onPaste={handlePaste}
            ref={editorRef}
            role="textbox"
            suppressContentEditableWarning
          />
        </div>
        <div className="composer-footer">
          <div className="composer-toolbar" aria-label="Message formatting tools">
            {TEXT_FORMAT_OPTIONS.map((option) => (
              <button
                aria-pressed={activeMarks[option.command]}
                className={`composer-tool ${activeMarks[option.command] ? 'composer-tool-active' : ''}`}
                key={option.title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  toggleEditorCommand(editorRef.current, option.command, syncEditorDraft);
                  setActiveMarks(getActiveEditorCommands());
                }}
                title={option.title}
                type="button"
              >
                <span className={`composer-tool-${option.styleClass}`}>{option.label}</span>
              </button>
            ))}
            <button
              aria-expanded={isLinkPopoverOpen}
              className={`composer-tool composer-tool-link ${isLinkPopoverOpen ? 'composer-tool-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openLinkPopover}
              title={LINK_FORMAT_OPTION.title}
              type="button"
            >
              {LINK_FORMAT_OPTION.label}
            </button>
          </div>
          {isLinkPopoverOpen && (
            <div aria-label="Insert link" className="link-popover" onKeyDown={handleLinkPopoverKeyDown} role="dialog">
              <label>
                <span>Text</span>
                <input
                  ref={linkTextInputRef}
                  onChange={(event) => setLinkDraft((current) => ({ ...current, text: event.target.value, error: '' }))}
                  placeholder="Display text"
                  value={linkDraft.text}
                />
              </label>
              <label>
                <span>Link</span>
                <input
                  inputMode="url"
                  onChange={(event) => setLinkDraft((current) => ({ ...current, url: event.target.value, error: '' }))}
                  placeholder="https://example.com"
                  value={linkDraft.url}
                />
              </label>
              {linkDraft.error && <p className="link-popover-error">{linkDraft.error}</p>}
              <div className="link-popover-actions">
                <button className="link-popover-secondary" onClick={closeLinkPopover} type="button">Cancel</button>
                <button className="link-popover-primary" onClick={insertLink} type="button">Insert</button>
              </div>
            </div>
          )}
          <span className="composer-meta">{socketStatusLabel(socketStatus)} - {draftText.length}/4000</span>
          <button className="send-button" disabled={isSending || !draftText.trim() || draft.length > 4000 || socketStatus !== 'connected'} type="submit">{isSending ? 'Sending...' : 'Send'}</button>
        </div>
      </form>
    </>
  );
}

function EmptyDirectState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="empty-dm-state">
      <div className="empty-dm-mark">@</div>
      <h2>{hasQuery ? 'Pick a teammate from search' : 'Find someone to DM'}</h2>
      <p>Search uses your workspace name, so only people from the same company/workspace can appear and start a direct chat.</p>
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="text-xs font-black uppercase tracking-[0.14em] text-white/42">{title}</h2>
      </div>
      <div className="grid gap-1">{children}</div>
    </section>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="date-divider">
      <span />
      <p>{label}</p>
      <span />
    </div>
  );
}

type AvatarProps = {
  initials: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'light';
  status?: 'online' | 'away' | 'offline' | 'focus';
};

type TextFormatCommand = (typeof TEXT_FORMAT_OPTIONS)[number]['command'];

function Avatar({ initials, size = 'md', tone = 'default', status }: AvatarProps) {
  const sizeClass = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';
  const toneClass = tone === 'light' ? 'bg-white text-[#18242d]' : 'avatar-gradient text-white';

  return (
    <span className={`avatar relative grid shrink-0 place-items-center rounded-xl font-black shadow-sm ${sizeClass} ${toneClass}`}>
      {initials}
      {status && <span className={`avatar-status presence-${status}`} />}
    </span>
  );
}

function upsertConversation(conversations: DirectConversation[], conversation: DirectConversation) {
  return [conversation, ...conversations.filter((item) => item.id !== conversation.id)];
}

function mergeRealtimeMessage(messages: RealtimeMessage[], serverMessage: DirectMessage, clientMessageId?: string) {
  const existingIndex = messages.findIndex((message) => message.id === serverMessage.id || (clientMessageId && message.clientMessageId === clientMessageId));

  if (existingIndex === -1) {
    return [...messages, { ...serverMessage, status: 'sent' as const }];
  }

  return messages.map((message, index) => (index === existingIndex ? { ...serverMessage, status: 'sent' as const } : message));
}

function markMessageFailed(messages: RealtimeMessage[], clientMessageId: string) {
  return messages.map((message) => (message.clientMessageId === clientMessageId ? { ...message, status: 'failed' as const } : message));
}

function createClientMessageId() {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return 'PC';
  }

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

function formatMessageTime(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(date));
}

function formatMessagePreview(content: string) {
  if (!content.trim()) {
    return '';
  }

  const element = document.createElement('div');
  element.innerHTML = sanitizeMessageHtml(content);
  return element.textContent?.trim() || 'Rich text message';
}

function sanitizeMessageHtml(content: string) {
  const sanitized = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: MESSAGE_HTML_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel', 'data-type', 'data-id', 'class'],
    ALLOW_DATA_ATTR: true
  });
  const element = document.createElement('div');
  element.innerHTML = sanitized;

  element.querySelectorAll('a').forEach((link) => {
    const href = normalizeLinkUrl(link.getAttribute('href') || '');

    if (!href) {
      link.replaceWith(document.createTextNode(link.textContent || ''));
      return;
    }

    link.setAttribute('href', href);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });

  return element.innerHTML;
}

function toggleEditorCommand(editor: HTMLDivElement | null, command: TextFormatCommand, onChange: () => void) {
  if (!editor) {
    return;
  }

  editor.focus();
  document.execCommand(command);
  onChange();
}

function getActiveEditorCommands(): Record<TextFormatCommand, boolean> {
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    strikeThrough: document.queryCommandState('strikeThrough'),
    insertUnorderedList: document.queryCommandState('insertUnorderedList'),
    insertOrderedList: document.queryCommandState('insertOrderedList')
  };
}

function findClosestLink(node: Node | null, editor: HTMLDivElement) {
  let current: Node | null = node;

  while (current && current !== editor) {
    if (current instanceof HTMLAnchorElement) {
      return current;
    }

    current = current.parentNode;
  }

  return null;
}

function normalizeLinkUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;

  try {
    const url = new URL(withProtocol);
    const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:'];

    if (!allowedProtocols.includes(url.protocol)) {
      return '';
    }

    return url.href;
  } catch {
    return '';
  }
}

function createLinkHtml(text: string, href: string) {
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

function escapeHtml(content: string) {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function socketStatusLabel(status: SocketStatus) {
  const labels: Record<SocketStatus, string> = {
    connecting: 'Connecting',
    connected: 'Realtime on',
    disconnected: 'Reconnecting',
    error: 'Realtime offline'
  };

  return labels[status];
}

function socketStatusHelp(status: SocketStatus) {
  const copy: Record<SocketStatus, string> = {
    connecting: 'Opening a secure socket connection for live direct messages.',
    connected: 'New messages sync instantly in active conversations.',
    disconnected: 'Trying to reconnect. New sends are paused until the socket returns.',
    error: 'Realtime messaging is unavailable. Refresh or sign in again if this persists.'
  };

  return copy[status];
}

export default Workspace;
