import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import type { User } from '../../types/auth';
import type { AttachmentInfo, ThreadReply as ThreadReplyType } from '../../api/messaging';
import { canPreviewInBrowser, formatFileSize, getFileDownloadUrl, getFileExtension } from '../../api/messaging';
import type { RealtimeMessage, SocketStatus } from './types';
import Avatar from './Avatar';
import EmojiPickerPopover from './EmojiPickerPopover';
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
  Smile
} from 'lucide-react';
import {
  createLinkHtml,
  escapeHtml,
  formatMessageTime,
  getInitials,
  normalizeLinkUrl,
  sanitizeMessageHtml
} from './messageUtils';
import {
  findClosestLink,
  getActiveEditorCommands,
  insertTextAtSavedSelection,
  toggleCodeBlock,
  toggleEditorCommand,
  toggleInlineCode,
  type TextFormatCommand
} from './editorUtils';
import MentionDropdown from './MentionDropdown';
import { detectMentionAtCursor, insertMentionAtCursor, type MentionMatch, type MentionSelection } from './mentionUtils';
import { createClientMessageId } from './messageUtils';
import type { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from './types';
import {
  loadRecentEmojis,
  MAX_RECENT_EMOJIS,
  persistRecentEmojis,
  updateRecentEmojis,
  type RecentEmoji,
  type SelectedEmoji
} from './recentEmojis';
import { usePopoverPosition } from './usePopoverPosition';

/* ─── ThreadPanel props ─── */

type ThreadPanelProps = {
  parentMessage: RealtimeMessage;
  currentUserId: string;
  user: User;
  accessToken: string;
  socketStatus: SocketStatus;
  onClose: () => void;
  /** Number of current replies (0 = empty) */
  replyCount: number;
  /** The socket instance for realtime communication */
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  /** Callback when a reply is sent (to update counts in the parent) */
  onReplyCountChange?: (messageId: string, newCount: number) => void;
  /** Callback to update unread counts */
  onUnreadCountChange?: (messageId: string, unreadCount: number) => void;
  /** Initial replies if already loaded */
  initialReplies?: ThreadReplyType[];
  /** Whether this thread has already been marked as read */
  alreadyRead?: boolean;
};

const TEXT_FORMAT_OPTIONS = [
  { icon: Bold, title: 'Bold', command: 'bold' },
  { icon: Italic, title: 'Italic', command: 'italic' },
  { icon: Underline, title: 'Underline', command: 'underline' },
  { icon: Strikethrough, title: 'Strikethrough', command: 'strikeThrough' },
  { icon: List, title: 'Bulleted list', command: 'insertUnorderedList' },
  { icon: ListOrdered, title: 'Numbered list', command: 'insertOrderedList' }
] as const;
const EMOJI_PICKER_ID = 'thread-emoji-picker';

function ThreadPanel({
  parentMessage,
  currentUserId,
  user,
  accessToken,
  socketStatus,
  onClose,
  replyCount,
  socket,
  onReplyCountChange,
  onUnreadCountChange,
  initialReplies = [],
  alreadyRead = false
}: ThreadPanelProps) {
  const [replies, setReplies] = useState<ThreadReplyType[]>(initialReplies);
  const [isLoadingReplies, setIsLoadingReplies] = useState(initialReplies.length === 0);
  const [draftHtml, setDraftHtml] = useState('');
  const [draftText, setDraftText] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null);
  const [mentionCursorRect, setMentionCursorRect] = useState<DOMRect | null>(null);
  const [activeMarks, setActiveMarks] = useState<Record<TextFormatCommand, boolean>>({
    bold: false, italic: false, underline: false, strikeThrough: false,
    insertUnorderedList: false, insertOrderedList: false, code: false, codeBlock: false
  });
  const [isLinkPopoverOpen, setIsLinkPopoverOpen] = useState(false);
  const [isEmojiPopoverOpen, setIsEmojiPopoverOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ text: '', url: '', error: '' });
  const [recentEmojis, setRecentEmojis] = useState<RecentEmoji[]>(() => loadRecentEmojis());
  const isInCodeBlock = activeMarks.codeBlock;
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [replyDeleteConfirmId, setReplyDeleteConfirmId] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const linkTextInputRef = useRef<HTMLInputElement | null>(null);
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const repliesEndRef = useRef<HTMLDivElement | null>(null);

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
    gap: 6
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
    gap: 6
  });
  const mentionMatchRef = useRef<MentionMatch | null>(null);
  mentionMatchRef.current = mentionMatch;
  const markedReadRef = useRef(alreadyRead);

  // Load replies on mount if not provided
  useEffect(() => {
    if (initialReplies.length === 0) {
      setIsLoadingReplies(true);
      import('../../api/messaging').then(({ listThreadReplies }) => {
        listThreadReplies(accessToken, parentMessage.id)
          .then((data) => {
            setReplies(data.replies);
          })
          .catch(() => {
            setReplies([]);
          })
          .finally(() => {
            setIsLoadingReplies(false);
          });
      });
    }
  }, [parentMessage.id, accessToken, initialReplies.length]);

  // Listen for new replies via socket (skip own — handled by callback)
  useEffect(() => {
    if (!socket) return;

    const handleNewReply = (payload: { reply: ThreadReplyType; replyCount: number }) => {
      // Skip replies from current user to avoid duplicates with optimistic update
      if (payload.reply.sender.id === currentUserId) return;

      if (payload.reply.messageId === parentMessage.id) {
        setReplies((current) => {
          // Avoid duplicates (e.g. from reconnection)
          if (current.some((r) => r.id === payload.reply.id)) return current;
          return [...current, payload.reply];
        });
      }
    };

    socket.on('thread:reply:new', handleNewReply);
    return () => {
      socket.off('thread:reply:new', handleNewReply);
    };
  }, [socket, parentMessage.id, currentUserId]);

  // Listen for reply deletions
  useEffect(() => {
    if (!socket) return;

    const handleReplyDeleted = (payload: { replyId: string; messageId: string }) => {
      if (payload.messageId === parentMessage.id) {
        setReplies((current) => current.filter((r) => r.id !== payload.replyId));
      }
    };

    socket.on('thread:reply:deleted', handleReplyDeleted);
    return () => {
      socket.off('thread:reply:deleted', handleReplyDeleted);
    };
  }, [socket, parentMessage.id]);

  // Close delete confirm on Escape
  useEffect(() => {
    if (!replyDeleteConfirmId) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setReplyDeleteConfirmId(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [replyDeleteConfirmId]);

  // Mark thread as read when opening
  useEffect(() => {
    if (markedReadRef.current || !socket || socketStatus !== 'connected') return;
    markedReadRef.current = true;

    socket.emit('thread:mark-read', { messageId: parentMessage.id }, (response) => {
      if (response?.ok) {
        onUnreadCountChange?.(parentMessage.id, 0);
      }
    });
  }, [socket, socketStatus, parentMessage.id, onUnreadCountChange]);

  // Close thread panel on Escape key
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Scroll to bottom when replies change
  useEffect(() => {
    repliesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [replies.length]);

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
    setMentionOpen(false);
    setMentionMatch(null);
  }, []);

  // Close popovers on outside click / Escape
  useEffect(() => {
    if (!isLinkPopoverOpen && !isEmojiPopoverOpen && !mentionOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (composerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.mention-dropdown')) return;
      if (target instanceof Element && target.closest('.emoji-popover')) return;
      if (target instanceof Element && target.closest('.thread-panel')) return;
      if (target instanceof Element && target.closest('.link-popover')) return;
      closeAllPopovers();
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeAllPopovers();
      editorRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isEmojiPopoverOpen, isLinkPopoverOpen, mentionOpen, closeAllPopovers]);

  const saveEditorSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    savedSelectionRef.current = range.cloneRange();
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
    const html = editor.innerHTML;
    setDraftHtml(sanitizeMessageHtml(html));
    setDraftText(editor.textContent || '');
    saveEditorSelection();
    editor.focus();
  }, [closeMentionDropdown]);

  const handleEditorInput = () => {
    const editor = editorRef.current;
    if (!editor) {
      closeMentionDropdown();
      return;
    }

    const match = detectMentionAtCursor(editor);
    if (match) {
      setMentionMatch(match);
      mentionMatchRef.current = match;
      setMentionQuery(match.query);
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

    setDraftHtml(sanitizeMessageHtml(editor.innerHTML));
    setDraftText(editor.textContent || '');
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (mentionOpen && (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Escape')) {
      return;
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    if (!event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      handleSendReply();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    const content = html ? sanitizeMessageHtml(html) : escapeHtml(text).replace(/\r?\n/g, '<br>');
    document.execCommand('insertHTML', false, content);
    handleEditorInput();
  };

  const handleSendReply = () => {
    if (!draftText.trim() || isSending) return;

    const content = sanitizeMessageHtml(draftHtml);
    const clientReplyId = createClientMessageId();
    const timestamp = new Date().toISOString();

    // Optimistic update
    const optimisticReply: ThreadReplyType = {
      id: clientReplyId,
      content,
      createdAt: timestamp,
      updatedAt: timestamp,
      sender: {
        id: user.id,
        name: user.name,
        email: user.email,
        workspaceName: user.workspaceName,
        avatar: user.avatar
      },
      messageId: parentMessage.id,
      conversationId: parentMessage.conversationId || ''
    };

    setReplies((current) => [...current, optimisticReply]);
    setDraftHtml('');
    setDraftText('');
    if (editorRef.current) editorRef.current.innerHTML = '';
    setIsSending(true);
    setSendError('');

    if (!socket || socketStatus !== 'connected') {
      setSendError('Realtime connection is offline. Try again.');
      setReplies((current) => current.filter((r) => r.id !== clientReplyId));
      setIsSending(false);
      return;
    }

    socket.emit('thread:reply', {
      messageId: parentMessage.id,
      content,
      conversationId: parentMessage.conversationId
    }, (response) => {
      setIsSending(false);
      if (!response?.ok) {
        setReplies((current) => current.filter((r) => r.id !== clientReplyId));
        setSendError(response?.message || 'Unable to send reply.');
        // Restore draft
        setDraftHtml(content);
        setDraftText(draftText);
      } else {
        // Replace optimistic reply with real one
        setReplies((current) => {
          const existing = current.find((r) => r.id === clientReplyId);
          if (existing && response.replyId) {
            return current.map((r) =>
              r.id === clientReplyId ? { ...r, id: response.replyId! } : r
            );
          }
          // Optimistic was removed (e.g. by error handler), add real reply
          if (response.replyId) {
            return [...current, { ...optimisticReply, id: response.replyId as string }];
          }
          return current;
        });
        // Count updated via Workspace socket listener — no local increment
      }
    });
  };

  const openLinkPopover = () => {
    if (isInCodeBlock) return;
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
    handleEditorInput();
    closeLinkPopover();
  };

  const handleLinkPopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); closeLinkPopover(); }
    if (event.key === 'Enter') { event.preventDefault(); insertLink(); }
  };

  const openEmojiPopover = () => {
    if (isInCodeBlock) return;
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

  /* ── Emoji functions ── */

  const insertEmoji = useCallback((emoji: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    insertTextAtSavedSelection(editor, savedSelectionRef, emoji);
    const html = editor.innerHTML;
    setDraftHtml(sanitizeMessageHtml(html));
    setDraftText(editor.textContent || '');
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

  const isParentOwn = parentMessage.sender.id === currentUserId;

  return (
    <aside className="thread-panel" role="complementary" aria-label="Thread">
      {/* Header */}
      <header className="thread-panel-header">
        <h2 className="thread-panel-title">Thread</h2>
        <button
          aria-label="Close thread panel"
          className="thread-panel-close"
          onClick={onClose}
          type="button"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 5l10 10M15 5l-10 10" />
          </svg>
        </button>
      </header>

      <div className="thread-panel-body">
        {/* Parent message pinned at top — compact summary */}
        <div className="thread-parent-summary">
          <div className="thread-parent-row">
            <Avatar initials={getInitials(parentMessage.sender.name)} size="sm" />
            <h3 className="thread-parent-name">{isParentOwn ? 'You' : parentMessage.sender.name}</h3>
            <span className="thread-parent-time">{formatMessageTime(parentMessage.createdAt)}</span>
          </div>
          {parentMessage.content && (
            <div
              className="thread-parent-content"
              dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(parentMessage.content) }}
            />
          )}
          {parentMessage.attachments && parentMessage.attachments.length > 0 && (
            <div className="thread-parent-attachments">
              {parentMessage.attachments.map((attachment) => (
                <ThreadAttachmentCard attachment={attachment} key={attachment.id} />
              ))}
            </div>
          )}
        </div>

        {/* Divider with reply count — hidden when empty */}
        {replies.length > 0 && (
          <div className="thread-divider">
            <span />
            <p>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</p>
            <span />
          </div>
        )}

        {/* Replies area */}
        <div className="thread-replies-area">
          {isLoadingReplies ? (
            <div className="thread-replies-empty">
              <div className="thread-loader" />
              <span>Loading replies…</span>
            </div>
          ) : replies.length > 0 ? (
            replies.map((reply) => {
              const isOwnReply = reply.sender.id === currentUserId;
              const isOptimistic = reply.id.startsWith('client-');
              const isDeleteConfirm = replyDeleteConfirmId === reply.id;
              return (
                <article
                  className={`thread-reply ${isOptimistic ? 'thread-reply-optimistic' : ''}`}
                  key={reply.id}
                >
                  <Avatar initials={getInitials(reply.sender.name)} size="xs" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <h3 className="thread-reply-name">{isOwnReply ? 'You' : reply.sender.name}</h3>
                      <span className="thread-reply-time">
                        {isOptimistic ? 'Sending…' : formatMessageTime(reply.createdAt)}
                      </span>
                      {isOwnReply && !isOptimistic && socket && !isDeleteConfirm && (
                        <button
                          className="thread-reply-delete"
                          onClick={() => setReplyDeleteConfirmId(reply.id)}
                          title="Delete reply"
                          type="button"
                        >
                          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 4h10m-1.5 0l-.6 7.2a1.5 1.5 0 01-1.5 1.3H5.6a1.5 1.5 0 01-1.5-1.3L3.5 4m2 0V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5V4" />
                          </svg>
                        </button>
                      )}
                      {isDeleteConfirm && (
                        <span className="thread-reply-delete-confirm-actions">
                          <button
                            className="thread-reply-delete-yes"
                            onClick={() => {
                              setReplyDeleteConfirmId(null);
                              socket?.emit('thread:reply:delete', { replyId: reply.id });
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                          <span className="thread-reply-delete-sep">/</span>
                          <button
                            className="thread-reply-delete-no"
                            onClick={() => setReplyDeleteConfirmId(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </span>
                      )}
                    </div>
                    <div
                      className="thread-reply-content"
                      dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(reply.content) }}
                    />
                  </div>
                </article>
              );
            })
          ) : (
            <div className="thread-replies-empty">
              <div className="thread-replies-empty-icon">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </div>
              <p>No replies yet</p>
              <span>Start the conversation.</span>
            </div>
          )}
          <div ref={repliesEndRef} />
        </div>
      </div>

      {/* Thread composer at bottom */}
      <div className="thread-composer-wrapper">
        {sendError && <p className="thread-composer-error">{sendError}</p>}
        <form
          className="thread-composer"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            handleSendReply();
          }}
          ref={composerRef}
        >
          <div className="thread-composer-input">
            <div
              aria-label="Reply in thread"
              className="thread-composer-editor"
              contentEditable
              data-placeholder="Reply in thread…"
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

          <div className="thread-composer-footer">
            <div className="composer-toolbar" aria-label="Reply formatting tools">
              {TEXT_FORMAT_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    aria-pressed={activeMarks[option.command]}
                    className={`composer-tool ${activeMarks[option.command] ? 'composer-tool-active' : ''}`}
                    disabled={isInCodeBlock}
                    key={option.title}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      toggleEditorCommand(editorRef.current, option.command, () => {});
                      setActiveMarks(getActiveEditorCommands());
                    }}
                    aria-label={option.title}
                    title={isInCodeBlock ? `${option.title} is unavailable in a code block` : option.title}
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
                disabled={isInCodeBlock}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  toggleInlineCode(editorRef.current, () => {});
                  setActiveMarks(getActiveEditorCommands());
                }}
                aria-label="Inline code"
                title={isInCodeBlock ? 'Inline code is unavailable in a code block' : 'Inline code'}
                type="button"
              >
                <Code size={16} />
              </button>
              <button
                aria-pressed={activeMarks.codeBlock}
                className={`composer-tool ${activeMarks.codeBlock ? 'composer-tool-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  toggleCodeBlock(editorRef.current, () => {
                    handleEditorInput();
                  });
                  setActiveMarks(getActiveEditorCommands());
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
                disabled={isInCodeBlock}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openLinkPopover}
                aria-label="Insert link"
                title={isInCodeBlock ? 'Links are unavailable in a code block' : 'Insert link'}
                type="button"
              >
                <Link size={16} />
              </button>
              <button
                ref={emojiButtonRef}
                aria-controls={EMOJI_PICKER_ID}
                aria-expanded={isEmojiPopoverOpen}
                className={`composer-tool ${isEmojiPopoverOpen ? 'composer-tool-active' : ''}`}
                disabled={isInCodeBlock}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openEmojiPopover}
                aria-label="Insert emoji"
                title={isInCodeBlock ? 'Emoji are unavailable in a code block' : 'Insert emoji'}
                type="button"
              >
                <Smile size={16} />
              </button>
            </div>

            {isLinkPopoverOpen && createPortal(
              <div ref={linkPopoverRef} aria-label="Insert link" className="link-popover" onKeyDown={handleLinkPopoverKeyDown} role="dialog" style={linkPopoverStyle}>
                <label><span>Text</span><input ref={linkTextInputRef} onChange={(event) => setLinkDraft((current) => ({ ...current, text: event.target.value, error: '' }))} placeholder="Display text" value={linkDraft.text} /></label>
                <label><span>Link</span><input inputMode="url" onChange={(event) => setLinkDraft((current) => ({ ...current, url: event.target.value, error: '' }))} placeholder="https://example.com" value={linkDraft.url} /></label>
                {linkDraft.error && <p className="link-popover-error">{linkDraft.error}</p>}
                <div className="link-popover-actions">
                  <button className="link-popover-secondary" onClick={closeLinkPopover} type="button">Cancel</button>
                  <button className="link-popover-primary" onClick={insertLink} type="button">Insert</button>
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

            <button
              className="send-button"
              disabled={!draftText.trim() || isSending}
              type="submit"
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}

/* ─── Thread attachment card (compact version) ─── */

function ThreadAttachmentCard({ attachment }: { attachment: AttachmentInfo }) {
  const isImage = attachment.mimeType.startsWith('image/');
  const ext = getFileExtension(attachment.originalName);
  const fileUrl = getFileDownloadUrl(attachment);
  const canPreview = canPreviewInBrowser(attachment.mimeType);

  if (isImage) {
    return (
      <a className="thread-attachment-image-link" href={fileUrl} target="_blank" rel="noopener noreferrer">
        <img alt={attachment.originalName} className="thread-attachment-image" loading="lazy" src={fileUrl} />
      </a>
    );
  }

  return (
    <a
      className="thread-attachment-file"
      download={attachment.originalName}
      href={canPreview ? fileUrl : undefined}
      rel="noopener noreferrer"
      target={canPreview ? '_blank' : undefined}
      onClick={!canPreview ? (e) => {
        e.preventDefault();
        const anchor = document.createElement('a');
        anchor.href = fileUrl;
        anchor.download = attachment.originalName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } : undefined}
    >
      <div className="thread-attachment-icon"><span>{ext || '?'}</span></div>
      <div className="min-w-0 flex-1">
        <span className="thread-attachment-name" title={attachment.originalName}>{attachment.originalName}</span>
        <span className="thread-attachment-meta">{formatFileSize(attachment.size)}</span>
      </div>
    </a>
  );
}

export default memo(ThreadPanel);
