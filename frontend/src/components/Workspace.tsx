import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent
} from 'react';
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

type WorkspaceProps = {
  user: User;
  accessToken: string;
  isLoading: boolean;
  onLogout: () => Promise<void>;
};

const TEXT_FORMAT_OPTIONS = [
  { label: 'B', title: 'Bold', command: 'bold', styleClass: 'bold' },
  { label: 'I', title: 'Italic', command: 'italic', styleClass: 'italic' },
  { label: 'U', title: 'Underline', command: 'underline', styleClass: 'underline' },
  { label: 'S', title: 'Strikethrough', command: 'strikeThrough', styleClass: 'strikethrough' },
  { label: '\u2022', title: 'Bulleted list', command: 'insertUnorderedList', styleClass: 'unordered-list' },
  { label: '1.', title: 'Numbered list', command: 'insertOrderedList', styleClass: 'ordered-list' }
] as const;
const CODE_FORMAT_OPTION = { label: '<>', title: 'Inline code' } as const;
const CODE_BLOCK_OPTION = { label: 'pre', title: 'Code block' } as const;
const LINK_FORMAT_OPTION = { label: 'Link', title: 'Insert link' };
const EMOJI_FORMAT_OPTION = { label: 'Emoji', title: 'Insert emoji' };
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
    socketStatus,
    startConversation,
    updateDraft
  } = useDirectMessaging(accessToken, user);
  const initials = getInitials(user.name);
  const activeParticipant = activeConversation?.participant ?? null;
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

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

      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
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
      </div>
    </main>
  );
}

/* ─── Message stream (conversation messages only) ─── */

function MessageStream({
  messages,
  participant,
  user,
  onMentionClick
}: {
  messages: RealtimeMessage[];
  participant: Teammate;
  user: User;
  onMentionClick?: (userId: string, userName: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isInitialLoad = useRef(true);

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

  // Scroll when messages arrive — handles initial load, sent messages, and received messages
  useEffect(() => {
    if (!scrollRef.current || !messages.length) return;

    // If this is the initial load for a new conversation, scroll instantly and exit
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      scrollToBottom(false);
      return;
    }

    const el = scrollRef.current;
    const lastMessage = messages[messages.length - 1];
    const isOwnMessage = lastMessage.sender.id === user.id;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;

    // Always scroll for own (sent) messages; for received, only if user is near bottom
    if (isOwnMessage || isNearBottom) {
      scrollToBottom(true);
    }
  }, [messages, scrollToBottom, user.id]);

  return (
    <div className="conversation-stream" ref={scrollRef}>
      <DateDivider label="Today" />
      {messages.length ? (
        messages.map((message, index) => {
          const isOwn = message.sender.id === user.id;

          return (
            <article
              className={`message-card ${isOwn ? 'message-card-own' : ''}`}
              key={message.id}
              style={{ animationDelay: `${index * 55}ms` }}
            >
              <Avatar initials={getInitials(message.sender.name)} status={isOwn ? 'online' : undefined} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <h3 className="text-sm font-black leading-5">{isOwn ? 'You' : message.sender.name}</h3>
                  <span className="text-xs font-bold text-[#8a939d]">{formatMessageTime(message.createdAt)}</span>
                  {message.status && message.status !== 'sent' && (
                    <span className={`message-status message-status-${message.status}`}>
                      {message.status}
                    </span>
                  )}
                </div>
                {message.content && (
                  <div
                    className="message-content mt-0.5 text-[0.92rem] leading-6 text-[#343940]"
                    dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(message.content) }}
                    onClick={(event) => {
                      // Click on mention span — open a DM with that user
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

  /* ── @mention state ── */
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null);

  const syncEditorDraft = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onDraftChange(sanitizeMessageHtml(editor.innerHTML), editor.textContent || '');
  };

  const closeMentionDropdown = useCallback(() => {
    setMentionOpen(false);
    setMentionMatch(null);
    setMentionQuery('');
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

  // Close popovers on outside click / Escape / scroll
  useEffect(() => {
    if (!isLinkPopoverOpen && !isEmojiPopoverOpen && !mentionOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Don't close if clicking inside the composer
      if (composerRef.current?.contains(target)) return;
      // Don't close if clicking inside the portaled mention dropdown
      if (target instanceof Element && target.closest('.mention-dropdown')) return;
      setIsLinkPopoverOpen(false);
      setIsEmojiPopoverOpen(false);
      setLinkDraft({ text: '', url: '', error: '' });
      closeMentionDropdown();
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsLinkPopoverOpen(false);
      setIsEmojiPopoverOpen(false);
      setLinkDraft({ text: '', url: '', error: '' });
      closeMentionDropdown();
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
  }, [isEmojiPopoverOpen, isLinkPopoverOpen, mentionOpen, closeMentionDropdown]);

  /* ── Link popover ── */

  const openLinkPopover = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor) return;

    editor.focus();
    setIsEmojiPopoverOpen(false);

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

          <span aria-hidden="true" className="composer-toolbar-divider" />

          <button
            aria-pressed={activeMarks.code}
            className={`composer-tool composer-tool-code ${activeMarks.code ? 'composer-tool-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              toggleInlineCode(editorRef.current, syncEditorDraft);
              setActiveMarks(getActiveEditorCommands());
            }}
            title={CODE_FORMAT_OPTION.title}
            type="button"
          >
            {CODE_FORMAT_OPTION.label}
          </button>
          <button
            className="composer-tool composer-tool-code-block"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              insertCodeBlock(editorRef.current, syncEditorDraft);
            }}
            title={CODE_BLOCK_OPTION.title}
            type="button"
          >
            {CODE_BLOCK_OPTION.label}
          </button>

          <span aria-hidden="true" className="composer-toolbar-divider" />

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
          <button
            aria-controls={EMOJI_PICKER_ID}
            aria-expanded={isEmojiPopoverOpen}
            className={`composer-tool composer-tool-emoji ${isEmojiPopoverOpen ? 'composer-tool-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openEmojiPopover}
            title={EMOJI_FORMAT_OPTION.title}
            type="button"
          >
            {EMOJI_FORMAT_OPTION.label}
          </button>

          <span aria-hidden="true" className="composer-toolbar-divider" />

          <button
            className="composer-tool composer-tool-attach"
            onClick={handleFileButtonClick}
            title="Attach file"
            type="button"
          >
            +Attach
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
              <button className="link-popover-secondary" onClick={closeLinkPopover} type="button">
                Cancel
              </button>
              <button className="link-popover-primary" onClick={insertLink} type="button">
                Insert
              </button>
            </div>
          </div>
        )}

        {isEmojiPopoverOpen && (
          <EmojiPickerPopover
            id={EMOJI_PICKER_ID}
            onClose={handleCloseEmojiPopover}
            onEmojiSelect={handleEmojiSelect}
            onRecentEmojiSelect={handleRecentEmojiInsert}
            recentEmojis={recentEmojis}
          />
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
