import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent
} from 'react';
import type { Teammate } from '../api/messaging';
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
import type { RealtimeMessage, SocketStatus } from './workspace/types';
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

              {activeParticipant ? (
                <div className="conversation-panel flex min-h-0 flex-1 flex-col overflow-hidden">
                  <MessageStream
                    key={activeParticipant.id}
                    messages={messages}
                    participant={activeParticipant}
                    user={user}
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
                draft={draftHtml}
                draftText={draftText}
                isSending={isSending}
                onDraftChange={updateDraft}
                onSubmit={sendMessage}
                participant={activeParticipant}
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
  user
}: {
  messages: RealtimeMessage[];
  participant: Teammate;
  user: User;
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
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="font-black">{isOwn ? 'You' : message.sender.name}</h3>
                  <span className="text-xs font-bold text-[#8a939d]">{formatMessageTime(message.createdAt)}</span>
                  {message.status && (
                    <span className={`message-status message-status-${message.status}`}>
                      {message.status}
                    </span>
                  )}
                </div>
                <div
                  className="message-content mt-2 text-[0.95rem] leading-7 text-[#343940]"
                  dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(message.content) }}
                />
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

/* ─── Message composer (editor, toolbar, popovers) ─── */

function MessageComposer({
  participant,
  draft,
  draftText,
  isSending,
  socketStatus,
  onDraftChange,
  onSubmit
}: {
  participant: Teammate;
  draft: string;
  draftText: string;
  isSending: boolean;
  socketStatus: SocketStatus;
  onDraftChange: (html: string, text: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
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

  const syncEditorDraft = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onDraftChange(sanitizeMessageHtml(editor.innerHTML), editor.textContent || '');
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

  // Close popovers on outside click / Escape
  useEffect(() => {
    if (!isLinkPopoverOpen && !isEmojiPopoverOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || composerRef.current?.contains(target)) return;
      setIsLinkPopoverOpen(false);
      setIsEmojiPopoverOpen(false);
      setLinkDraft({ text: '', url: '', error: '' });
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsLinkPopoverOpen(false);
      setIsEmojiPopoverOpen(false);
      setLinkDraft({ text: '', url: '', error: '' });
      editorRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isEmojiPopoverOpen, isLinkPopoverOpen]);

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

  return (
    <form
      className="composer-shell"
      onSubmit={(event) => {
        onSubmit(event);
      }}
      ref={composerRef}
    >
      <div className="dm-composer-input">
        <div
          aria-label={`Message ${participant.name}`}
          className="dm-composer-editor"
          contentEditable
          data-placeholder={`Message ${participant.name}`}
          onBlur={saveEditorSelection}
          onFocus={saveEditorSelection}
          onInput={syncEditorDraft}
          onKeyUp={saveEditorSelection}
          onMouseUp={saveEditorSelection}
          onKeyDown={handleEditorKeyDown}
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
        </span>
        <button
          className="send-button"
          disabled={isSending || !draftText.trim() || draft.length > 4000 || socketStatus !== 'connected'}
          type="submit"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
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
