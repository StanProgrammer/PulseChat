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
  insertTextAtSavedSelection,
  toggleEditorCommand,
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
  { label: 'UL', title: 'Bulleted list', command: 'insertUnorderedList', styleClass: 'unordered-list' },
  { label: 'OL', title: 'Numbered list', command: 'insertOrderedList', styleClass: 'ordered-list' }
] as const;
const LINK_FORMAT_OPTION = { label: 'Link', title: 'Insert link' };
const EMOJI_FORMAT_OPTION = { label: 'Emoji', title: 'Insert emoji' };
const EMOJI_PICKER_ID = 'composer-emoji-picker';

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

  return (
    <main className="workspace-shell min-h-screen bg-[#eef1f4] text-[#17191c]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <WorkspaceSidebar
          activeConversationId={activeConversation?.id}
          conversations={conversations}
          isLoading={isLoading}
          isSearching={isSearching}
          isStartingConversation={isStartingConversation}
          onLogout={onLogout}
          onQueryChange={setQuery}
          onSelectConversation={setActiveConversationId}
          onStartConversation={startConversation}
          query={query}
          searchResults={searchResults}
          user={user}
        />

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
                <MemoizedDirectConversationPanel
                  draft={draftHtml}
                  draftText={draftText}
                  isSending={isSending}
                  messages={messages}
                  onDraftChange={updateDraft}
                  onSubmit={sendMessage}
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
  const composerRef = useRef<HTMLFormElement | null>(null);
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
  const [isEmojiPopoverOpen, setIsEmojiPopoverOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ text: '', url: '', error: '' });
  const [recentEmojis, setRecentEmojis] = useState<RecentEmoji[]>(() => loadRecentEmojis());

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

  useEffect(() => {
    if (!isLinkPopoverOpen && !isEmojiPopoverOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node) || composerRef.current?.contains(target)) {
        return;
      }

      setIsLinkPopoverOpen(false);
      setIsEmojiPopoverOpen(false);
      setLinkDraft({ text: '', url: '', error: '' });
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

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

  const syncEditorDraft = () => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    onDraftChange(sanitizeMessageHtml(editor.innerHTML), editor.textContent || '');
  };

  const saveEditorSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }

    savedSelectionRef.current = range.cloneRange();
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

  const openEmojiPopover = () => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

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

    if (!editor) {
      return;
    }

    editor.focus();
    insertTextAtSavedSelection(editor, savedSelectionRef, emoji);
    syncEditorDraft();
    setIsEmojiPopoverOpen(false);
  }, []);

  const handleCloseEmojiPopover = useCallback(() => {
    setIsEmojiPopoverOpen(false);
    editorRef.current?.focus();
  }, []);

  const handleEmojiSelect = useCallback((emojiData: SelectedEmoji) => {
    insertEmoji(emojiData.native);
    setRecentEmojis((current) => {
      const next = updateRecentEmojis(current, emojiData);
      persistRecentEmojis(next);
      return next;
    });
  }, [insertEmoji]);

  const handleRecentEmojiInsert = useCallback((emoji: RecentEmoji) => {
    insertEmoji(emoji.emoji);
    setRecentEmojis((current) => {
      const next = [emoji, ...current.filter((item) => item.unified !== emoji.unified)].slice(0, MAX_RECENT_EMOJIS);
      persistRecentEmojis(next);
      return next;
    });
  }, [insertEmoji]);

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

      <form className="composer-shell" onSubmit={onSubmit} ref={composerRef}>
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
                <button className="link-popover-secondary" onClick={closeLinkPopover} type="button">Cancel</button>
                <button className="link-popover-primary" onClick={insertLink} type="button">Insert</button>
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
          <span className="composer-meta">{socketStatusLabel(socketStatus)} - {draftText.length}/4000</span>
          <button className="send-button" disabled={isSending || !draftText.trim() || draft.length > 4000 || socketStatus !== 'connected'} type="submit">{isSending ? 'Sending...' : 'Send'}</button>
        </div>
      </form>
    </>
  );
}

const MemoizedDirectConversationPanel = memo(DirectConversationPanel);

function EmptyDirectState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="empty-dm-state">
      <div className="empty-dm-mark">@</div>
      <h2>{hasQuery ? 'Pick a teammate from search' : 'Find someone to DM'}</h2>
      <p>Search uses your workspace name, so only people from the same company/workspace can appear and start a direct chat.</p>
    </div>
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

export default Workspace;
