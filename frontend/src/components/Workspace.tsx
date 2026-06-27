import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent
} from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Code,
  Terminal,
  Link,
  Smile,
  Paperclip
} from 'lucide-react';
import {
  canPreviewInBrowser,
  formatFileSize,
  getFileExtension,
  getFileDownloadUrl,
  uploadFile
} from '../api/messaging';
import type {
  AttachmentInfo,
  Teammate
} from '../api/messaging';
import type { User } from '../types/auth';
import Avatar from './workspace/Avatar';
import EmojiPickerPopover from './workspace/EmojiPickerPopover';
import {
  findClosestLink,
  getActiveEditorCommands,
  handleListEnterKey,
  insertCodeBlock,
  insertTextAtSavedSelection,
  toggleEditorCommand,
  toggleInlineCode,
  type TextFormatCommand
} from './workspace/editorUtils';
import {
  createLinkHtml,
  escapeHtml,
  formatMessageTime,
  getInitials,
  normalizeLinkUrl,
  prepareContentForEditing,
  sanitizeMessageHtml,
  socketStatusLabel
} from './workspace/messageUtils';
import type { PendingFile, RealtimeMessage, SocketStatus } from './workspace/types';
import { useDirectMessaging } from './workspace/useDirectMessaging';
import WorkspaceSidebar from './workspace/WorkspaceSidebar';
import {
  loadRecentEmojis,
  MAX_RECENT_EMOJIS,
  persistRecentEmojis,
  updateRecentEmojis,
  type RecentEmoji,
  type SelectedEmoji
} from './workspace/recentEmojis';
import {
  detectMentionAtCursor,
  insertMentionAtCursor,
  type MentionMatch,
  type MentionSelection
} from './workspace/mentionUtils';
import MentionDropdown from './workspace/MentionDropdown';
import ThreadPanel from './workspace/ThreadPanel';
import { usePopoverPosition } from './workspace/usePopoverPosition';

type WorkspaceProps = {
  user: User;
  accessToken: string;
  isLoading: boolean;
  onLogout: () => Promise<void>;
};

const TEXT_FORMAT_OPTIONS = [
  { icon: Bold, title: 'Bold', command: 'bold' },
  { icon: Italic, title: 'Italic', command: 'italic' },
  { icon: Underline, title: 'Underline', command: 'underline' },
  { icon: Strikethrough, title: 'Strikethrough', command: 'strikeThrough' },
  { icon: List, title: 'Bulleted list', command: 'insertUnorderedList' },
  { icon: ListOrdered, title: 'Numbered list', command: 'insertOrderedList' }
] as const;
const EMOJI_PICKER_ID = 'composer-emoji-picker';
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv'
]);
const ACCEPTED_UPLOAD_EXTENSIONS = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

function Workspace({ user, accessToken, isLoading, onLogout }: WorkspaceProps) {
  const {
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
    sendMessage,
    setActiveConversationId,
    setQuery,
    socketRef,
    socketStatus,
    startConversation,
    updateMessage,
    deleteMessage,
    updateDraft
  } = useDirectMessaging(accessToken, user);
  const initials = getInitials(user.name);
  const activeParticipant = activeConversation?.participant ?? null;
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [threadMessage, setThreadMessage] = useState<RealtimeMessage | null>(null);
  // Track thread reply counts per message (keyed by message ID)
  const [threadReplyCounts, setThreadReplyCounts] = useState<Record<string, number>>({});
  // Track unread thread replies per message
  const [threadUnreadCounts, setThreadUnreadCounts] = useState<Record<string, number>>({});

  // Load thread reply counts and unread counts on conversation mount
  useEffect(() => {
    if (!accessToken) return;
    const convId = activeConversation?.id;
    if (!convId) return;

    void import('../api/messaging').then(({ getThreadReplyCountsForConversation, getUnreadThreadReplies }) => {
      // Load actual reply counts from backend
      getThreadReplyCountsForConversation(accessToken, convId)
        .then((res: { replyCounts: Record<string, number> }) => setThreadReplyCounts(res.replyCounts))
        .catch(() => {});

      // Load unread counts
      getUnreadThreadReplies(accessToken, convId)
        .then((res: { unreadCounts: Record<string, number> }) => setThreadUnreadCounts(res.unreadCounts))
        .catch(() => {});
    });
  }, [accessToken, activeConversation?.id]);

  // Listen for unread thread updates via socket
  useEffect(() => {
    if (!socketRef.current) return;
    const socket = socketRef.current;

    const handleUnreadUpdated = (payload: { unreadCounts: Record<string, number> }) => {
      setThreadUnreadCounts(payload.unreadCounts);
    };

    socket.on('thread:unread:updated', handleUnreadUpdated);
    return () => {
      socket.off('thread:unread:updated', handleUnreadUpdated);
    };
  }, [socketRef]);

  // Listen for new thread replies to update reply counts
  useEffect(() => {
    if (!socketRef.current) return;
    const socket = socketRef.current;

    const handleNewThreadReply = (payload: { reply: import('../api/messaging').ThreadReply; replyCount: number }) => {
      setThreadReplyCounts((current) => ({
        ...current,
        [payload.reply.messageId]: payload.replyCount
      }));
    };

    socket.on('thread:reply:new', handleNewThreadReply);
    return () => {
      socket.off('thread:reply:new', handleNewThreadReply);
    };
  }, [socketRef]);

  // Listen for thread reply deletions to update reply counts
  useEffect(() => {
    if (!socketRef.current) return;
    const socket = socketRef.current;

    const handleThreadReplyDeleted = (payload: { replyId: string; messageId: string; replyCount: number }) => {
      setThreadReplyCounts((current) => ({
        ...current,
        [payload.messageId]: payload.replyCount
      }));
    };

    socket.on('thread:reply:deleted', handleThreadReplyDeleted);
    return () => {
      socket.off('thread:reply:deleted', handleThreadReplyDeleted);
    };
  }, [socketRef]);

  // Function to update reply count from ThreadPanel
  const handleReplyCountChange = useCallback((messageId: string, newCount: number) => {
    setThreadReplyCounts((current) => ({
      ...current,
      [messageId]: newCount
    }));
  }, []);

  // Function to update unread count from ThreadPanel
  const handleUnreadCountChange = useCallback((messageId: string, unreadCount: number) => {
    setThreadUnreadCounts((current) => {
      if (unreadCount === 0) {
        const next = { ...current };
        delete next[messageId];
        return next;
      }
      return { ...current, [messageId]: unreadCount };
    });
  }, []);

  // Auto-close sidebar when resizing from desktop to tablet/mobile
  useEffect(() => {
    if (isSidebarOpen && !isDesktop) {
      setIsSidebarOpen(false);
    }
  }, [isDesktop]);

  const handleSelectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setIsSidebarOpen(false);
  };

  const handleStartConversation = async (teammate: Teammate) => {
    await startConversation(teammate);
    setIsSidebarOpen(false);
  };

  const [fileError, setFileError] = useState('');

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files?.length) return;

    const newFiles: PendingFile[] = [];
    let skippedForSize = 0;
    let skippedForType = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > MAX_FILE_SIZE) {
        skippedForSize++;
        continue;
      }

      if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.type)) {
        skippedForType++;
        continue;
      }

      const pendingFile: PendingFile = {
        id: `pending-${Date.now()}-${i}`,
        file,
        progress: 0,
        status: 'pending',
        previewUrl: file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined
      };

      newFiles.push(pendingFile);
    }

    if (skippedForSize > 0 || skippedForType > 0) {
      const messages = [];

      if (skippedForSize > 0) {
        messages.push(`${skippedForSize} file${skippedForSize > 1 ? 's were' : ' was'} over 20 MB`);
      }

      if (skippedForType > 0) {
        messages.push(`${skippedForType} file${skippedForType > 1 ? 's were' : ' was'} not an allowed image or document`);
      }

      setFileError(`${messages.join('; ')}.`);
      window.setTimeout(() => setFileError(''), 5000);
    }

    setPendingFiles((current) => [...current, ...newFiles].slice(0, 10));
  }, []);

  // Clear pending files when switching conversations
  useEffect(() => {
    if (pendingFiles.length > 0) {
      pendingFiles.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
      setPendingFiles([]);
    }
  }, [activeConversation?.id]);

  const handleRemoveFile = useCallback((fileId: string) => {
    setPendingFiles((current) => {
      const file = current.find((f) => f.id === fileId);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return current.filter((f) => f.id !== fileId);
    });
  }, []);

  const handleRetryFile = useCallback(async (fileId: string) => {
    setPendingFiles((current) =>
      current.map((f) => f.id === fileId ? { ...f, status: 'pending' as const, progress: 0, error: undefined } : f)
    );
  }, []);

  const handleSubmitWithFiles = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeConversation?.id || (!draftText.trim() && pendingFiles.length === 0)) {
      return;
    }

    // Upload any pending files
    const attachmentIds = pendingFiles
      .filter((f) => f.status === 'done' && f.attachmentInfo)
      .map((f) => f.attachmentInfo!.id);
    const uploading = pendingFiles.filter((f) => f.status === 'pending' || f.status === 'error');

    for (const pendingFile of uploading) {
      setPendingFiles((current) =>
        current.map((f) => f.id === pendingFile.id ? { ...f, status: 'uploading' as const, progress: 0 } : f)
      );

      try {
        const result = await uploadFile(accessToken, pendingFile.file, (percent) => {
          setPendingFiles((current) =>
            current.map((f) => f.id === pendingFile.id ? { ...f, progress: percent } : f)
          );
        });

        attachmentIds.push(result.attachment.id);
        setPendingFiles((current) =>
          current.map((f) => f.id === pendingFile.id
            ? { ...f, status: 'done' as const, progress: 100, attachmentInfo: result.attachment }
            : f
          )
        );
      } catch (uploadError) {
        setPendingFiles((current) =>
          current.map((f) => f.id === pendingFile.id
            ? { ...f, status: 'error' as const, error: uploadError instanceof Error ? uploadError.message : 'Upload failed.' }
            : f
          )
        );
        return;
      }
    }

    // Collect attachment info for optimistic message
    const pendingAttachments = pendingFiles
      .filter((f) => f.status === 'done' && f.attachmentInfo)
      .map((f) => f.attachmentInfo!);

    setPendingFiles([]);

    // Send the message with attachment IDs via the existing sendMessage function
    sendMessage(event, { attachmentIds, pendingAttachments });
  }, [activeConversation, draftHtml, draftText, pendingFiles, sendMessage, socketStatus, user, accessToken]);

  // Close thread when switching conversations
  useEffect(() => {
    setThreadMessage(null);
  }, [activeConversation?.id]);

  const handleOpenThread = useCallback((message: RealtimeMessage) => {
    setThreadMessage(message);
  }, []);

  const handleCloseThread = useCallback(() => {
    setThreadMessage(null);
  }, []);

  return (
    <main className="workspace-shell min-h-dvh overflow-x-hidden bg-[#eef1f4] text-[#17191c]">
      {isSidebarOpen && !isDesktop && (
        <button
          aria-label="Close conversation list"
          className="workspace-sidebar-backdrop"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      )}

      <div className={`grid min-h-dvh ${threadMessage ? 'lg:grid-cols-[320px_minmax(0,1fr)_380px] xl:grid-cols-[320px_minmax(0,1fr)_420px]' : 'lg:grid-cols-[320px_minmax(0,1fr)]'}`}>
        <WorkspaceSidebar
          activeConversationId={activeConversation?.id}
          conversations={conversations}
          isDesktop={isDesktop}
          isOpen={isSidebarOpen}
          isLoading={isLoading}
          isSearching={isSearching}
          isStartingConversation={isStartingConversation}
          onLogout={onLogout}
          onClose={() => setIsSidebarOpen(false)}
          onQueryChange={setQuery}
          onSelectConversation={handleSelectConversation}
          onStartConversation={handleStartConversation}
          query={query}
          searchResults={searchResults}
          user={user}
        />

        <section className="flex h-dvh min-w-0 flex-col overflow-hidden">
          {/* ── Compact header ── */}
          <header className="workspace-header z-20 border-b border-[#d9dee4] bg-white/86 backdrop-blur-xl">
            <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
              <div className="flex min-w-0 items-center gap-2">
                {!isDesktop && (
                  <button
                    aria-controls="workspace-sidebar"
                    aria-expanded={isSidebarOpen}
                    aria-label="Open conversation list"
                    className="mobile-menu-button"
                    onClick={() => setIsSidebarOpen(true)}
                    type="button"
                  >
                    <span />
                    <span />
                    <span />
                  </button>
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-base font-black text-[#17191c]">
                    {activeParticipant ? activeParticipant.name : 'Direct messages'}
                  </h1>
                  {activeParticipant && (
                    <p className="hidden truncate text-xs font-semibold text-[#707984] sm:block">
                      {activeParticipant.email}
                    </p>
                  )}
                </div>
              </div>
              <Avatar initials={initials} size="sm" />
            </div>
          </header>

          {/* ── Message area ── */}
          <div className="chat-main flex-1 min-h-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col px-3 pt-3 pb-0 sm:px-6 sm:pt-5">
              {error && <p className="dm-error mb-3">{error}</p>}
              {fileError && <p className="dm-error mb-3">{fileError}</p>}

              {activeParticipant ? (
                <div className="conversation-panel flex min-h-0 flex-1 flex-col overflow-hidden">
                  <MessageStream
                    key={activeParticipant.id}
                    messages={messages}
                    participant={activeParticipant}
                    user={user}
                    accessToken={accessToken}
                    conversationId={activeConversation?.id}
                    threadMessageId={threadMessage?.id ?? null}
                    threadReplyCounts={threadReplyCounts}
                    threadUnreadCounts={threadUnreadCounts}
                    onOpenThread={handleOpenThread}
                    onUpdateMessage={updateMessage}
                    onDeleteMessage={deleteMessage}
                    onMentionClick={(userId, userName) => {
                      // Start a DM with the mentioned user
                      const teammate: Teammate = {
                        id: userId,
                        name: userName,
                        email: '',
                        workspaceName: user.workspaceName,
                        avatar: null
                      };
                      handleStartConversation(teammate);
                    }}
                  />
                </div>
              ) : (
                <div className="conversation-panel h-full">
                  <EmptyDirectState hasQuery={Boolean(query.trim())} isDesktop={isDesktop} onOpenSidebar={() => setIsSidebarOpen(true)} />
                </div>
              )}
            </div>
          </div>

          {/* ── Composer (outside the conversation panel) ── */}
          {activeParticipant && (
            <div className="flex-shrink-0 px-3 pb-3 pt-2 sm:px-6">
              <MessageComposer
                accessToken={accessToken}
                currentUserId={user.id}
                activeConversationId={activeConversation?.id}
                draft={draftHtml}
                draftText={draftText}
                isSending={isSending}
                onDraftChange={updateDraft}
                onSubmit={handleSubmitWithFiles}
                onFileSelect={handleFileSelect}
                onRemoveFile={handleRemoveFile}
                onRetryFile={handleRetryFile}
                participant={activeParticipant}
                pendingFiles={pendingFiles}
                socketStatus={socketStatus}
              />
            </div>
          )}
        </section>

        {/* ── Thread panel (when a thread is open) ── */}
        {threadMessage && (
          <ThreadPanel
            accessToken={accessToken}
            currentUserId={user.id}
            onClose={handleCloseThread}
            parentMessage={threadMessage}
            replyCount={threadReplyCounts[threadMessage.id] || 0}
            socket={socketRef.current}
            socketStatus={socketStatus}
            user={user}
            onReplyCountChange={handleReplyCountChange}
            onUnreadCountChange={handleUnreadCountChange}
          />
        )}
      </div>
    </main>
  );
}

/* ─── Message stream (conversation messages only) ─── */

const EDIT_TEXT_FORMATS = [
  { icon: Bold, title: 'Bold', command: 'bold' },
  { icon: Italic, title: 'Italic', command: 'italic' },
  { icon: Underline, title: 'Underline', command: 'underline' },
  { icon: Strikethrough, title: 'Strikethrough', command: 'strikeThrough' }
] as const;

function MessageStream({
  messages,
  participant,
  user,
  accessToken,
  conversationId,
  threadMessageId,
  threadReplyCounts,
  threadUnreadCounts,
  onOpenThread,
  onUpdateMessage,
  onDeleteMessage,
  onMentionClick
}: {
  messages: RealtimeMessage[];
  participant: Teammate;
  user: User;
  accessToken: string;
  conversationId?: string;
  threadMessageId: string | null;
  threadReplyCounts: Record<string, number>;
  threadUnreadCounts: Record<string, number>;
  onOpenThread: (message: RealtimeMessage) => void;
  onUpdateMessage: (messageId: string, content: string, conversationId: string) => void;
  onDeleteMessage: (messageId: string, conversationId: string) => void;
  onMentionClick?: (userId: string, userName: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isInitialLoad = useRef(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editInitialContent, setEditInitialContent] = useState('');
  const [openMenuMessageId, setOpenMenuMessageId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const editEditorRef = useRef<HTMLDivElement | null>(null);
  const editMentionMatchRef = useRef<MentionMatch | null>(null);
  const [editMentionOpen, setEditMentionOpen] = useState(false);
  const [editMentionQuery, setEditMentionQuery] = useState('');
  const [editMentionMatch, setEditMentionMatch] = useState<MentionMatch | null>(null);
  const [editMentionCursorRect, setEditMentionCursorRect] = useState<DOMRect | null>(null);
  const [editMarks, setEditMarks] = useState<Record<string, boolean>>({
    bold: false, italic: false, underline: false, strikeThrough: false
  });
  const editEditorInitializedRef = useRef(false);
  const [kebabMenuPosition, setKebabMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const kebabMenuAlignRef = useRef<'left' | 'right'>('right');

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;

    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Mark as initial load when switching conversations (remount via key)
  useEffect(() => {
    isInitialLoad.current = true;
  }, [participant.id]);

  // Scroll when messages arrive
  useEffect(() => {
    if (!scrollRef.current || !messages.length) return;

    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      scrollToBottom(false);
      return;
    }

    const el = scrollRef.current;
    const lastMessage = messages[messages.length - 1];
    const isOwnMessage = lastMessage.sender.id === user.id;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;

    if (isOwnMessage || isNearBottom) {
      scrollToBottom(true);
    }
  }, [messages, scrollToBottom, user.id]);

  // Set editor innerHTML directly on the DOM when entering edit mode.
  // We intentionally avoid dangerouslySetInnerHTML here because React
  // would re-apply the original content on every re-render (e.g. when
  // formatting marks update, mention dropdown opens, etc.), which resets
  // the cursor position and wipes out the user's edits.
  // Instead, we set innerHTML once via the DOM ref in a useEffect.
  useEffect(() => {
    if (editingMessageId && editInitialContent && editEditorRef.current) {
      editEditorRef.current.innerHTML = editInitialContent;
      editEditorInitializedRef.current = true;
    }
    if (!editingMessageId) {
      editEditorInitializedRef.current = false;
    }
  }, [editingMessageId, editInitialContent]);

  // Focus the edit editor when entering edit mode (must run AFTER content
  // is set, so both effects depend on editingMessageId — React runs them
  // in definition order).
  useEffect(() => {
    if (editingMessageId && editEditorRef.current && editEditorInitializedRef.current) {
      editEditorRef.current.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(editEditorRef.current);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }, [editingMessageId]);

  // Track formatting marks for edit editor
  useEffect(() => {
    if (!editingMessageId) return;
    const updateMarks = () => {
      const editor = editEditorRef.current;
      const sel = window.getSelection();
      if (!editor || !sel?.rangeCount || !editor.contains(sel.anchorNode)) return;
      setEditMarks({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough')
      });
    };
    document.addEventListener('selectionchange', updateMarks);
    return () => document.removeEventListener('selectionchange', updateMarks);
  }, [editingMessageId]);

  // Close kebab menu on outside click and scroll
  useEffect(() => {
    if (!openMenuMessageId) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.message-kebab-menu')) return;
      if (target instanceof Element && target.closest('.message-kebab-trigger')) return;
      setOpenMenuMessageId(null);
      setKebabMenuPosition(null);
    };
    document.addEventListener('mousedown', handleClick);

    // Close kebab menu when the conversation stream scrolls so the
    // fixed-position menu doesn't visually detach from its message.
    const scrollEl = document.querySelector('.conversation-stream');
    const handleScroll = () => {
      setOpenMenuMessageId(null);
      setKebabMenuPosition(null);
    };
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      document.removeEventListener('mousedown', handleClick);
      if (scrollEl) {
        scrollEl.removeEventListener('scroll', handleScroll);
      }
    };
  }, [openMenuMessageId]);

  // Close delete confirm on Escape
  useEffect(() => {
    if (!deleteConfirmId) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setDeleteConfirmId(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [deleteConfirmId]);

  const startEditing = (message: RealtimeMessage) => {
    const prepared = prepareContentForEditing(message.content);
    setEditInitialContent(prepared);
    setEditingMessageId(message.id);
    setOpenMenuMessageId(null);
    setKebabMenuPosition(null);
  };



  const closeEditMention = useCallback(() => {
    setEditMentionOpen(false);
    setEditMentionMatch(null);
    setEditMentionQuery('');
    setEditMentionCursorRect(null);
  }, []);

  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditInitialContent('');
    closeEditMention();
  };

  const saveEdit = () => {
    if (!editingMessageId || !conversationId) return;
    const editor = editEditorRef.current;
    if (!editor) return;
    const rawHtml = editor.innerHTML;
    const textContent = (editor.textContent || '').trim();
    if (!textContent) return;
    const sanitized = sanitizeMessageHtml(rawHtml);
    onUpdateMessage(editingMessageId, sanitized, conversationId);
    setEditingMessageId(null);
    setEditInitialContent('');
    closeEditMention();
  };

  const handleEditInput = () => {
    const editor = editEditorRef.current;
    if (!editor) {
      closeEditMention();
      return;
    }
   
    // Check for @mention
    const match = detectMentionAtCursor(editor);
    if (match) {
      editMentionMatchRef.current = match;
      setEditMentionMatch(match);
      setEditMentionQuery(match.query);
      const sel = window.getSelection();
      let cursorRect: DOMRect | null = null;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
          cursorRect = range.getBoundingClientRect();
        }
      }
      setEditMentionCursorRect(cursorRect);
      setEditMentionOpen(true);
    } else {
      closeEditMention();
    }
  };

  const handleEditMentionSelect = useCallback((selection: MentionSelection) => {
    const editor = editEditorRef.current;
    const match = editMentionMatchRef.current;
    if (!editor || !match) return;
    insertMentionAtCursor(editor, match, selection);
    closeEditMention();
    editor.focus();
  }, [closeEditMention]);

  const handleEditPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    const content = html ? sanitizeMessageHtml(html) : escapeHtml(text).replace(/\r?\n/g, '<br>');
    document.execCommand('insertHTML', false, content);
  };

  const handleEditKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editMentionOpen && (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Escape')) {
      return; // handled by MentionDropdown
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      saveEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  };

  const toggleEditFormat = (command: string) => {
    const editor = editEditorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command);
    setEditMarks({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough')
    });
  };

  const confirmDelete = (messageId: string) => {
    setDeleteConfirmId(messageId);
    setOpenMenuMessageId(null);
    setKebabMenuPosition(null);
  };

  const executeDelete = () => {
    if (!deleteConfirmId || !conversationId) return;
    onDeleteMessage(deleteConfirmId, conversationId);
    setDeleteConfirmId(null);
  };

  const isEdited = (message: RealtimeMessage) => {
    return message.updatedAt !== message.createdAt;
  };

  const hasEditContent = () => {
    if (!editEditorRef.current) return false;
    return (editEditorRef.current.textContent || '').trim().length > 0;
  };

  const isEditUnchanged = (originalContent: string) => {
    const editor = editEditorRef.current;
    if (!editor) return true;
    // Both sides must use the same preparation to account for
    // contenteditable attribute differences on mention spans.
    // prepareContentForEditing strips contenteditable="false" from
    // mentions, matching what the editor DOM produces after the user
    // interacts with it.
    const preparedOriginal = prepareContentForEditing(originalContent);
    return sanitizeMessageHtml(editor.innerHTML) === sanitizeMessageHtml(preparedOriginal);
  };

  return (
    <div className="conversation-stream" ref={scrollRef}>
      <DateDivider label="Today" />

      {/* Delete confirmation dialog */}
      {deleteConfirmId && (
        <div className="delete-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="delete-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="delete-dialog-title">Delete message?</h3>
            <p className="delete-dialog-desc">
              This action cannot be undone. The message will be removed for everyone.
            </p>
            <div className="delete-dialog-actions">
              <button
                className="delete-dialog-secondary"
                onClick={() => setDeleteConfirmId(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="delete-dialog-primary"
                onClick={executeDelete}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {messages.length ? (
        messages.map((message, index) => {
          const isOwn = message.sender.id === user.id;
          const isEditing = editingMessageId === message.id;
          const menuOpen = openMenuMessageId === message.id;
          const edited = isEdited(message);
          const originalMessage = message; // keep ref for comparison

          return (
            <article
              className={`message-card ${isOwn ? 'message-card-own' : ''} ${isEditing ? 'message-card-editing' : ''} ${menuOpen ? 'message-card-menu-open' : ''}`}
              key={message.id}
              style={{ animationDelay: `${index * 55}ms` }}
            >
              <Avatar initials={getInitials(message.sender.name)} status={isOwn ? 'online' : undefined} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1">
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <h3 className="text-sm font-black leading-5">{isOwn ? 'You' : message.sender.name}</h3>
                    <span className="text-xs font-bold text-[#8a939d]">
                      {formatMessageTime(message.createdAt)}
                      {edited && <span className="edited-label"> (edited)</span>}
                    </span>
                    {message.status && message.status !== 'sent' && (
                      <span className={`message-status message-status-${message.status}`}>
                        {message.status}
                      </span>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="message-edit-shell">
                    {/* Formatting toolbar */}
                    <div className="message-edit-toolbar" aria-label="Edit formatting tools">
                      {EDIT_TEXT_FORMATS.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            aria-pressed={editMarks[opt.command]}
                            className={`composer-tool ${editMarks[opt.command] ? 'composer-tool-active' : ''}`}
                            key={opt.title}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => toggleEditFormat(opt.command)}                          aria-label={opt.title}
                          title={opt.title}
                          type="button"
                        >
                            <Icon size={14} />
                          </button>
                        );
                      })}
                    </div>

                    <div
                      className="message-edit-editor"
                      contentEditable
                      onInput={handleEditInput}
                      onKeyDown={handleEditKeyDown}
                      onPaste={handleEditPaste}
                      ref={editEditorRef}
                      role="textbox"
                      suppressContentEditableWarning
                    />

                    {/* @mention dropdown for edit editor */}
                    {editMentionOpen && editMentionMatch && (
                      <MentionDropdown
                        accessToken={accessToken}
                        query={editMentionQuery}
                        cursorRect={editMentionCursorRect}
                        excludeUserIds={[user.id]}
                        onSelect={handleEditMentionSelect}
                        onClose={closeEditMention}
                        editorElement={editEditorRef.current}
                      />
                    )}

                    <div className="message-edit-actions">
                      <span className="message-edit-hint">
                        Esc to cancel &middot; Enter to save
                      </span>
                      <div className="message-edit-buttons">
                        <button
                          className="message-edit-cancel"
                          onClick={cancelEditing}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="message-edit-save"
                          disabled={!hasEditContent() || isEditUnchanged(originalMessage.content)}
                          onClick={saveEdit}
                          type="button"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {message.content && (
                      <div
                        className="message-content mt-0.5 text-[0.92rem] leading-6 text-[#343940]"
                        dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(message.content) }}
                        onClick={(event) => {
                          const target = event.target;
                          if (
                            target instanceof HTMLElement &&
                            target.getAttribute('data-type') === 'mention'
                          ) {
                            event.preventDefault();
                            event.stopPropagation();
                            const userId = target.getAttribute('data-user-id');
                            const userName = target.getAttribute('data-user-name');
                            if (userId && userName && onMentionClick) {
                              onMentionClick(userId, userName);
                            }
                          }
                        }}
                      />
                    )}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="message-attachments">
                        {message.attachments.map((attachment) => (
                          <AttachmentCard attachment={attachment} key={attachment.id} />
                        ))}
                      </div>
                    )}

                    {/* Thread reply count indicator — prominent, always visible below message */}
                    {threadReplyCounts[message.id] > 0 && (
                      <button
                        className={`message-thread-reply-count ${threadUnreadCounts[message.id] > 0 ? 'message-thread-reply-unread' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenThread(message);
                        }}
                        type="button"
                      >
                        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" className="message-thread-reply-icon">
                          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1h-5l-3 3v-3H4a1 1 0 01-1-1V4z" fill="currentColor" opacity="0.65" />
                        </svg>
                        <span className="message-thread-reply-count-text">{threadReplyCounts[message.id]} {threadReplyCounts[message.id] === 1 ? 'reply' : 'replies'}</span>
                        {threadUnreadCounts[message.id] > 0 && (
                          <span className="thread-unread-badge">{threadUnreadCounts[message.id]}</span>
                        )}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Message actions (thread + kebab), visible on hover */}
              <div className="message-actions-group">
                {/* Reply in thread button — appears on hover for all messages */}
                {!isEditing && (
                  <button
                    aria-label="Reply in thread"
                    className={`message-thread-trigger ${threadMessageId === message.id ? 'message-thread-trigger-active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenThread(message);
                    }}
                    title="Reply in thread"
                    type="button"
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1h-5l-3 3v-3H4a1 1 0 01-1-1V4z" />
                    </svg>
                    <span className="message-thread-label">Reply</span>
                  </button>
                )}

                {/* Kebab menu for own messages (not while editing) */}
                {isOwn && !isEditing && (
                  <button
                    aria-label="Message actions"
                    className={`message-kebab-trigger ${menuOpen ? 'message-kebab-trigger-open' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (menuOpen) {
                        setOpenMenuMessageId(null);
                        setKebabMenuPosition(null);
                      } else {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const menuWidth = 152; // ~9.5rem
                        let left = rect.right - menuWidth;
                        let align: 'left' | 'right' = 'right';
                        if (left < 8) {
                          left = rect.left;
                          align = 'left';
                        }
                        if (left + menuWidth > window.innerWidth - 8) {
                          left = window.innerWidth - menuWidth - 8;
                        }
                        kebabMenuAlignRef.current = align;
                        setKebabMenuPosition({ left: Math.max(8, left), top: rect.bottom + 4 });
                        setOpenMenuMessageId(message.id);
                      }
                    }}
                    type="button"
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                      <circle cx="8" cy="3" r="1.5" />
                      <circle cx="8" cy="8" r="1.5" />
                      <circle cx="8" cy="13" r="1.5" />
                    </svg>
                  </button>
                )}
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

      {/* Portaled kebab menu — rendered at document body level to avoid clipping */}
      {openMenuMessageId && kebabMenuPosition && (() => {
        const message = messages.find((m) => m.id === openMenuMessageId);
        if (!message) return null;
        return createPortal(
          <div
            className={`message-kebab-menu ${kebabMenuAlignRef.current === 'left' ? 'message-kebab-menu-left' : ''}`}
            style={{
              position: 'fixed',
              left: kebabMenuPosition.left,
              top: kebabMenuPosition.top,
              zIndex: 100
            }}
          >
            <button
              className="message-kebab-item"
              onClick={() => startEditing(message)}
              type="button"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 2l3 3-9 9H2v-3z" />
              </svg>
              Edit message
            </button>
            <button
              className="message-kebab-item message-kebab-item-danger"
              onClick={() => confirmDelete(message.id)}
              type="button"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12m-2 0l-.7 8.4a2 2 0 01-2 1.6H6.7a2 2 0 01-2-1.6L4 4m2 0V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4" />
              </svg>
              Delete message
            </button>
          </div>,
          document.body
        );
      })()}
    </div>
  );
}



/* ─── File preview chips (compact horizontal layout) ─── */

function truncateFilename(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0 && name.length - ext < 12) {
    const base = name.slice(0, ext);
    const keep = maxLen - (name.length - ext) - 1;
    if (keep > 4) return `${base.slice(0, keep)}\u2026${name.slice(ext)}`;
  }
  return `${name.slice(0, maxLen - 1)}\u2026`;
}

function statusIcon(status: PendingFile['status']) {
  switch (status) {
    case 'pending':
      return <span className="fpc-status-icon fpc-status-icon-pending" title="Pending upload" />;
    case 'uploading':
      return <span className="fpc-status-icon fpc-status-icon-uploading" title="Uploading\u2026" />;
    case 'done':
      return (
        <span className="fpc-status-icon fpc-status-icon-done" title="Uploaded">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l3.5 3.5L13 5" />
          </svg>
        </span>
      );
    case 'error':
      return (
        <span className="fpc-status-icon fpc-status-icon-error" title="Upload failed">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4l8 8m0-8l-8 8" />
          </svg>
        </span>
      );
  }
}

function FilePreviewCard({ file, onRemove, onRetry }: { file: PendingFile; onRemove: (id: string) => void; onRetry?: (id: string) => void }) {
  const isImage = file.file.type.startsWith('image/');
  const ext = getFileExtension(file.file.name);
  const isFailed = file.status === 'error';
  const isUploading = file.status === 'uploading';

  return (
    <div className={`fpc ${isFailed ? 'fpc-error' : ''} ${isUploading ? 'fpc-uploading' : ''}`}>
      {/* Remove button */}
      <button
        className="fpc-remove"
        disabled={isUploading}
        onClick={() => onRemove(file.id)}
        title="Remove file"
        type="button"
      >
        <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 3l8 8m0-8l-8 8" />
        </svg>
      </button>

      {/* Thumbnail / file type icon */}
      {isImage && file.previewUrl ? (
        <img alt="" className="fpc-thumb" src={file.previewUrl} />
      ) : (
        <div className="fpc-icon">
          <span>{ext.slice(0, 3)}</span>
        </div>
      )}

      {/* File info */}
      <div className="fpc-info">
        <span className="fpc-name" title={file.file.name}>
          {truncateFilename(file.file.name, isImage ? 24 : 30)}
        </span>
        <span className="fpc-meta">
          {formatFileSize(file.file.size)}
          {file.status === 'done' && file.attachmentInfo && (
            <> \u00b7 Uploaded</>
          )}
          {isFailed && file.error && (
            <> \u00b7 Failed</>
          )}
        </span>
      </div>

      {/* Status indicator */}
      <div className="fpc-status-area">
        {statusIcon(file.status)}

        {/* Uploading progress bar (overlaid on card bottom) */}
        {isUploading && (
          <div className="fpc-progress-track">
            <div className="fpc-progress-fill" style={{ width: `${file.progress}%` }} />
          </div>
        )}
      </div>

      {/* Retry button for failed uploads */}
      {isFailed && onRetry && (
        <button
          className="fpc-retry"
          onClick={() => onRetry(file.id)}
          title="Retry upload"
          type="button"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 8a6 6 0 0 1 10.47-4M14 8a6 6 0 0 1-10.47 4" />
            <path d="M13.5 2.5V6h-3.5M2.5 13.5V10H6" />
          </svg>
          Retry
        </button>
      )}
    </div>
  );
}

/* ─── Message composer (editor, toolbar, popovers) ─── */

function MessageComposer({
  accessToken,
  currentUserId,
  activeConversationId,
  participant,
  draft,
  draftText,
  isSending,
  pendingFiles,
  socketStatus,
  onDraftChange,
  onFileSelect,
  onRemoveFile,
  onRetryFile,
  onSubmit
}: {
  accessToken: string;
  currentUserId: string;
  activeConversationId?: string;
  participant: Teammate;
  draft: string;
  draftText: string;
  isSending: boolean;
  pendingFiles: PendingFile[];
  socketStatus: SocketStatus;
  onDraftChange: (html: string, text: string) => void;
  onFileSelect: (files: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  onRetryFile: (id: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const savedSelectionRef = useRef<Range | null>(null);
  const linkTextInputRef = useRef<HTMLInputElement | null>(null);
  const [activeMarks, setActiveMarks] = useState<Record<TextFormatCommand, boolean>>({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    insertUnorderedList: false,
    insertOrderedList: false,
    code: false
  });
  const [isLinkPopoverOpen, setIsLinkPopoverOpen] = useState(false);
  const [isEmojiPopoverOpen, setIsEmojiPopoverOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ text: '', url: '', error: '' });
  const [recentEmojis, setRecentEmojis] = useState<RecentEmoji[]>(() => loadRecentEmojis());

  // Floating popover positioning (scroll-aware, flips to available space)
  const {
    style: linkPopoverStyle,
    popoverRef: linkPopoverRef
  } = usePopoverPosition({
    isOpen: isLinkPopoverOpen,
    triggerRef: linkButtonRef,
    preferredPlacement: 'top',
    width: 352,
    height: 220,
    gap: 8
  });

  const {
    style: emojiPopoverStyle,
    popoverRef: emojiPopoverRef
  } = usePopoverPosition({
    isOpen: isEmojiPopoverOpen,
    triggerRef: emojiButtonRef,
    preferredPlacement: 'top',
    width: 448,
    height: 420,
    gap: 8
  });

  /* ── @mention state ── */
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null);
  const [mentionCursorRect, setMentionCursorRect] = useState<DOMRect | null>(null);

  const syncEditorDraft = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onDraftChange(sanitizeMessageHtml(editor.innerHTML), editor.textContent || '');
  };

  const closeMentionDropdown = useCallback(() => {
    setMentionOpen(false);
    setMentionMatch(null);
    setMentionQuery('');
    setMentionCursorRect(null);
  }, []);

  const handleMentionSelect = useCallback((selection: MentionSelection) => {
    const editor = editorRef.current;
    const match = mentionMatchRef.current;
    if (!editor || !match) return;

    insertMentionAtCursor(editor, match, selection);
    closeMentionDropdown();
    syncEditorDraft();
    // Update the saved selection to point after the newly inserted mention
    saveEditorSelection();
    editor.focus();
  }, [closeMentionDropdown]);

  // Keep a ref for the mention match to avoid stale closures
  const mentionMatchRef = useRef<MentionMatch | null>(null);
  mentionMatchRef.current = mentionMatch;

  const handleEditorInput = () => {
    const editor = editorRef.current;
    if (!editor) {
      closeMentionDropdown();
      return;
    }

    // Check for @mention pattern at cursor
    const match = detectMentionAtCursor(editor);

    if (match) {
      setMentionMatch(match);
      mentionMatchRef.current = match;
      setMentionQuery(match.query);
      // Capture cursor position immediately while the selection is reliable
      const sel = window.getSelection();
      let cursorRect: DOMRect | null = null;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
          cursorRect = range.getBoundingClientRect();
        }
      }
      setMentionCursorRect(cursorRect);
      setMentionOpen(true);
    } else {
      closeMentionDropdown();
    }

    syncEditorDraft();
  };

  const saveEditorSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    savedSelectionRef.current = range.cloneRange();
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // When mention dropdown is open, Enter/arrow/escape keys are handled by the dropdown
    if (mentionOpen && (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Escape')) {
      // These keys are handled by the MentionDropdown's global keydown listener
      return;
    }

    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;

    const editor = editorRef.current;
    const shouldSendMessage = !event.shiftKey || event.ctrlKey || event.metaKey;

    if (shouldSendMessage) {
      event.preventDefault();
      composerRef.current?.requestSubmit();
      return;
    }

    if (editor && handleListEnterKey(editor)) {
      event.preventDefault();
      syncEditorDraft();
      saveEditorSelection();
      setActiveMarks(getActiveEditorCommands());
      return;
    }

    window.requestAnimationFrame(() => {
      syncEditorDraft();
      saveEditorSelection();
      setActiveMarks(getActiveEditorCommands());
    });
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    const content = html ? sanitizeMessageHtml(html) : escapeHtml(text).replace(/\r?\n/g, '<br>');
    document.execCommand('insertHTML', false, content);
    syncEditorDraft();
  };

  // Restore empty editor when switching conversations
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || draft || editor.innerHTML === '') return;
    editor.innerHTML = '';
  }, [draft]);

  // Track active formatting marks
  useEffect(() => {
    const updateActiveMarks = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
      setActiveMarks(getActiveEditorCommands());
    };
    document.addEventListener('selectionchange', updateActiveMarks);
    return () => document.removeEventListener('selectionchange', updateActiveMarks);
  }, []);

  const closeAllPopovers = useCallback(() => {
    setIsLinkPopoverOpen(false);
    setIsEmojiPopoverOpen(false);
    setLinkDraft({ text: '', url: '', error: '' });
    closeMentionDropdown();
  }, [closeMentionDropdown]);

  // Close popovers on outside click / Escape / scroll
  useEffect(() => {
    if (!isLinkPopoverOpen && !isEmojiPopoverOpen && !mentionOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Don't close if clicking inside the composer
      if (composerRef.current?.contains(target)) return;
      // Don't close if clicking inside ported popovers
      if (target instanceof Element && target.closest('.mention-dropdown')) return;
      if (target instanceof Element && target.closest('.emoji-popover')) return;
      if (target instanceof Element && target.closest('.link-popover')) return;
      closeAllPopovers();
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeAllPopovers();
      editorRef.current?.focus();
    };

    // Close mention dropdown when the message stream scrolls
    const handleScroll = () => {
      if (mentionOpen) closeMentionDropdown();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    // Find the scrollable message area
    const scrollEl = document.querySelector('.conversation-stream');
    if (mentionOpen && scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      if (scrollEl) {
        scrollEl.removeEventListener('scroll', handleScroll);
      }
    };
  }, [isEmojiPopoverOpen, isLinkPopoverOpen, mentionOpen, closeMentionDropdown, closeAllPopovers]);

  /* ── Link popover ── */

  const openLinkPopover = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor) return;

    editor.focus();
    setIsEmojiPopoverOpen(false);
    closeMentionDropdown();

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
    if (!editor || !selection) return;

    editor.focus();
    selection.removeAllRanges();
    if (savedSelectionRef.current) selection.addRange(savedSelectionRef.current);
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

  /* ── Drag-and-drop ── */

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    onFileSelect(event.dataTransfer.files);
  }, [onFileSelect]);

  /* ── File picker ── */

  const handleFileButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    onFileSelect(event.target.files);
    // Reset so the same file can be re-selected
    event.target.value = '';
  }, [onFileSelect]);

  /* ── Emoji popover ── */

  const openEmojiPopover = () => {
    const editor = editorRef.current;
    if (!editor) return;

    setIsLinkPopoverOpen(false);
    setLinkDraft({ text: '', url: '', error: '' });
    closeMentionDropdown();
    editor.focus();
    saveEditorSelection();

    if (!savedSelectionRef.current) {
      const fallbackRange = document.createRange();
      fallbackRange.selectNodeContents(editor);
      fallbackRange.collapse(false);
      savedSelectionRef.current = fallbackRange;
    }

    setIsEmojiPopoverOpen((current) => !current);
  };

  const insertEmoji = useCallback((emoji: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    insertTextAtSavedSelection(editor, savedSelectionRef, emoji);
    syncEditorDraft();
    setIsEmojiPopoverOpen(false);
  }, []);

  const handleCloseEmojiPopover = useCallback(() => {
    setIsEmojiPopoverOpen(false);
    editorRef.current?.focus();
  }, []);

  const handleEmojiSelect = useCallback(
    (emojiData: SelectedEmoji) => {
      insertEmoji(emojiData.native);
      setRecentEmojis((current) => {
        const next = updateRecentEmojis(current, emojiData);
        persistRecentEmojis(next);
        return next;
      });
    },
    [insertEmoji]
  );

  const handleRecentEmojiInsert = useCallback(
    (emoji: RecentEmoji) => {
      insertEmoji(emoji.emoji);
      setRecentEmojis((current) => {
        const next = [emoji, ...current.filter((item) => item.unified !== emoji.unified)].slice(0, MAX_RECENT_EMOJIS);
        persistRecentEmojis(next);
        return next;
      });
    },
    [insertEmoji]
  );

  /* ── File input (hidden) ── */

  const canSend = !isSending && (draftText.trim().length > 0 || pendingFiles.length > 0) && draft.length <= 4000 && socketStatus === 'connected';

  return (
    <form
      className={`composer-shell ${isDragOver ? 'composer-shell-dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onSubmit={(event) => {
        onSubmit(event);
      }}
      ref={composerRef}
    >
      <input
        accept={ACCEPTED_UPLOAD_EXTENSIONS}
        className="sr-only"
        multiple
        onChange={handleFileInputChange}
        ref={fileInputRef}
        type="file"
      />

      {isDragOver && (
        <div className="composer-drop-overlay">
          <span>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3v10m-5-5l5-5 5 5" />
              <path d="M3 16v1a1 1 0 001 1h12a1 1 0 001-1v-1" />
            </svg>
            Drop files here
          </span>
        </div>
      )}

      <div className="dm-composer-input dm-composer-input-with-mentions">
        <div
          aria-label={`Message ${participant.name}`}
          className="dm-composer-editor"
          contentEditable
          data-placeholder={`Message ${participant.name}`}
          onBlur={saveEditorSelection}
          onFocus={saveEditorSelection}
          onInput={handleEditorInput}
          onKeyUp={saveEditorSelection}
          onMouseUp={saveEditorSelection}
          onKeyDown={handleEditorKeyDown}
          onPaste={handlePaste}
          ref={editorRef}
          role="textbox"
          suppressContentEditableWarning
        />

        {/* Mention dropdown — rendered as a portal near the cursor */}
        {mentionOpen && mentionMatch && (
          <MentionDropdown
            accessToken={accessToken}
            query={mentionQuery}
            cursorRect={mentionCursorRect}
            excludeUserIds={[currentUserId]}
            onSelect={handleMentionSelect}
            onClose={closeMentionDropdown}
            editorElement={editorRef.current}
          />
        )}
      </div>

      {/* Pending file previews */}
      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="fpc-strip">
          {pendingFiles.map((file) => (
            <FilePreviewCard file={file} key={file.id} onRemove={onRemoveFile} onRetry={onRetryFile} />
          ))}
        </div>
      )}

      <div className="composer-footer">
        <div className="composer-toolbar" aria-label="Message formatting tools">
          {TEXT_FORMAT_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                aria-pressed={activeMarks[option.command]}
                className={`composer-tool ${activeMarks[option.command] ? 'composer-tool-active' : ''}`}
                key={option.title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  toggleEditorCommand(editorRef.current, option.command, syncEditorDraft);
                  setActiveMarks(getActiveEditorCommands());
                }}
                aria-label={option.title}
                title={option.title}
                type="button"
              >
                <Icon size={16} />
              </button>
            );
          })}

          <span aria-hidden="true" className="composer-toolbar-divider" />

          <button
            aria-pressed={activeMarks.code}
            className={`composer-tool ${activeMarks.code ? 'composer-tool-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              toggleInlineCode(editorRef.current, syncEditorDraft);
              setActiveMarks(getActiveEditorCommands());
            }}
            aria-label="Inline code"
            title="Inline code"
            type="button"
          >
            <Code size={16} />
          </button>
          <button
            className="composer-tool"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              insertCodeBlock(editorRef.current, syncEditorDraft);
            }}
            aria-label="Code block"
            title="Code block"
            type="button"
          >
            <Terminal size={16} />
          </button>

          <span aria-hidden="true" className="composer-toolbar-divider" />

          <button
            ref={linkButtonRef}
            aria-expanded={isLinkPopoverOpen}
            className={`composer-tool ${isLinkPopoverOpen ? 'composer-tool-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openLinkPopover}
            aria-label="Insert link"
            title="Insert link"
            type="button"
          >
            <Link size={16} />
          </button>
          <button
            ref={emojiButtonRef}
            aria-controls={EMOJI_PICKER_ID}
            aria-expanded={isEmojiPopoverOpen}
            className={`composer-tool ${isEmojiPopoverOpen ? 'composer-tool-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openEmojiPopover}
            aria-label="Insert emoji"
            title="Insert emoji"
            type="button"
          >
            <Smile size={16} />
          </button>

          <span aria-hidden="true" className="composer-toolbar-divider" />

          <button
            className="composer-tool"
            onClick={handleFileButtonClick}
            aria-label="Attach file"
            title="Attach file"
            type="button"
          >
            <Paperclip size={16} />
          </button>
        </div>

        {isLinkPopoverOpen && createPortal(
          <div ref={linkPopoverRef} aria-label="Insert link" className="link-popover" onKeyDown={handleLinkPopoverKeyDown} role="dialog" style={linkPopoverStyle}>
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
              <button className="link-popover-secondary" onClick={closeLinkPopover} type="button">
                Cancel
              </button>
              <button className="link-popover-primary" onClick={insertLink} type="button">
                Insert
              </button>
            </div>
          </div>,
          document.body
        )}

        {isEmojiPopoverOpen && createPortal(
          <EmojiPickerPopover
            id={EMOJI_PICKER_ID}
            innerRef={emojiPopoverRef}
            onClose={handleCloseEmojiPopover}
            onEmojiSelect={handleEmojiSelect}
            onRecentEmojiSelect={handleRecentEmojiInsert}
            recentEmojis={recentEmojis}
            style={emojiPopoverStyle}
          />,
          document.body
        )}

        <span className="composer-meta">
          {socketStatusLabel(socketStatus)} &mdash; {draftText.length}/4000
          {pendingFiles.length > 0 && (
            <> &middot; <span className="composer-meta-files">{pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}</span></>
          )}
        </span>
        <button
          className="send-button"
          disabled={!canSend}
          type="submit"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  );
}

/* ─── Attachment card (for rendering in message stream) ─── */

function AttachmentCard({ attachment }: { attachment: AttachmentInfo }) {
  const canPreview = canPreviewInBrowser(attachment.mimeType);
  const isImage = attachment.mimeType.startsWith('image/');
  const ext = getFileExtension(attachment.originalName);
  const fileUrl = getFileDownloadUrl(attachment);

  return (
    <div className="attachment-card">
      {isImage ? (
        <a className="attachment-card-image-link" href={fileUrl} target="_blank" rel="noopener noreferrer">
          <img
            alt={attachment.originalName}
            className="attachment-card-image"
            loading="lazy"
            src={fileUrl}
          />
        </a>
      ) : (
        <a
          className="attachment-card-file"
          download={attachment.originalName}
          href={canPreview ? fileUrl : undefined}
          hrefLang={attachment.mimeType}
          rel="noopener noreferrer"
          target={canPreview ? '_blank' : undefined}
          onClick={!canPreview ? (e) => {
            e.preventDefault();
            // Trigger download via a temporary anchor
            const anchor = document.createElement('a');
            anchor.href = fileUrl;
            anchor.download = attachment.originalName;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
          } : undefined}
        >
          <div className="attachment-card-icon">
            <span>{ext || '?'}</span>
          </div>
          <div className="attachment-card-info">
            <span className="attachment-card-name" title={attachment.originalName}>
              {attachment.originalName}
            </span>
            <span className="attachment-card-meta">
              {formatFileSize(attachment.size)}
              {!canPreview && ' \u00b7 Download'}
            </span>
          </div>
          <svg className="attachment-card-arrow" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 10h8m-4-4v8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}
    </div>
  );
}

/* ─── Empty state ─── */

function EmptyDirectState({ hasQuery, isDesktop, onOpenSidebar }: { hasQuery: boolean; isDesktop: boolean; onOpenSidebar: () => void }) {
  return (
    <div className="empty-dm-state">
      <div className="empty-dm-mark">@</div>
      <h2>{hasQuery ? 'Pick a teammate from search' : 'Find someone to DM'}</h2>
      <p>Search uses your workspace name, so only people from the same company/workspace can appear and start a direct chat.</p>
      {!isDesktop && (
        <button className="empty-dm-action" onClick={onOpenSidebar} type="button">
          Open conversations
        </button>
      )}
    </div>
  );
}

/* ─── Date divider ─── */

function DateDivider({ label }: { label: string }) {
  return (
    <div className="date-divider">
      <span />
      <p>{label}</p>
      <span />
    </div>
  );
}

export default Workspace;
