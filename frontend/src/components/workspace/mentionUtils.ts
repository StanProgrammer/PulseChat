import type { MutableRefObject } from 'react';
import { escapeHtml } from './messageUtils';

/**
 * Types of mentions supported (future-proof for channels and special mentions).
 */
export type MentionType = 'user' | 'channel' | 'special';

/**
 * Represents a parsed mention within the editor.
 */
export type MentionMatch = {
  /** Full match including the @ symbol, e.g. "@john" */
  fullMatch: string;
  /** Query text after @, e.g. "john" */
  query: string;
  /** Start offset of the match within the text node */
  startOffset: number;
  /** End offset of the match within the text node */
  endOffset: number;
  /** The text node containing the mention */
  textNode: Text;
  /** Type of mention */
  type: MentionType;
};

/**
 * Information about a selected mention to insert.
 */
export type MentionSelection = {
  userId: string;
  userName: string;
  type: MentionType;
};

const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;

export function normalizeMentionQuery(query: string): string {
  return query
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Return a viewport-relative caret rectangle for a collapsed editor selection.
 * Some browsers return an empty bounding box at line boundaries, so a
 * zero-width marker is used as a final, short-lived measurement fallback. */
export function getCaretViewportRect(editor: HTMLDivElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;

  const selectionRange = selection.getRangeAt(0);
  if (!editor.contains(selectionRange.commonAncestorContainer)) return null;

  const range = selectionRange.cloneRange();
  range.collapse(false);
  const clientRects = Array.from(range.getClientRects());
  let visibleRect: DOMRect | undefined;
  for (let index = clientRects.length - 1; index >= 0; index -= 1) {
    if (clientRects[index].height > 0) {
      visibleRect = clientRects[index];
      break;
    }
  }
  if (visibleRect) return visibleRect;

  const boundingRect = range.getBoundingClientRect();
  if (boundingRect.height > 0) return boundingRect;

  const marker = document.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = '\u200b';
  marker.style.cssText = 'display:inline-block;width:0;overflow:hidden;line-height:inherit;pointer-events:none';
  range.insertNode(marker);
  const markerRect = marker.getBoundingClientRect();
  marker.remove();
  return markerRect.height > 0 ? markerRect : null;
}

/**
 * Create the HTML for a mention span.
 */
export function createMentionHtml(mention: MentionSelection): string {
  const displayName = escapeHtml(mention.userName);
  const userId = escapeHtml(mention.userId);

  let dataAttrs = `data-type="mention" data-user-id="${userId}" data-user-name="${displayName}"`;
  // future: add data-channel-id for channel mentions, data-mention-type for special mentions

  return `<span ${dataAttrs} contenteditable="false">@${displayName}</span>`;
}

/**
 * Detect a mention pattern at the cursor position in a contentEditable.
 *
 * Looks backwards from the cursor to find a text node with an `@` symbol
 * preceded by whitespace or the start of the node.
 */
export function detectMentionAtCursor(editor: HTMLDivElement): MentionMatch | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if (!range.collapsed) return null; // Only trigger on collapsed cursor

  const { startContainer, startOffset } = range;

  // We need to be in a text node
  if (startContainer.nodeType !== Node.TEXT_NODE) return null;

  // Must be inside the editor
  if (!editor.contains(startContainer)) return null;

  const textNode = startContainer as Text;
  const text = textNode.textContent || '';
  const cursorPos = startOffset;

  // Get the text before cursor
  const beforeCursor = text.slice(0, cursorPos);

  // Find the last @ that's at word boundary (preceded by whitespace or start)
  const atIndex = beforeCursor.lastIndexOf('@');
  if (atIndex === -1) return null;

  // Check that @ is at word boundary (preceded by whitespace or start of text)
  if (atIndex > 0 && beforeCursor[atIndex - 1] !== ' ' && beforeCursor[atIndex - 1] !== '\u00A0') {
    return null;
  }

  // Don't trigger inside a code element
  if (isInsideCodeElement(textNode, editor)) return null;

  // Extract the query text after @
  const afterAt = text.slice(atIndex + 1, cursorPos);
  const normalizedQuery = normalizeMentionQuery(afterAt);

  // Query must not contain whitespace
  if (/\s/.test(afterAt.replace(ZERO_WIDTH_CHARS, ''))) return null;
  // Query length limit
  if (normalizedQuery.length > 30) return null;

  return {
    fullMatch: `@${afterAt}`,
    query: normalizedQuery,
    startOffset: atIndex,
    endOffset: cursorPos,
    textNode,
    type: 'user'
  };
}

/**
 * Check if a node is inside a <code> or <pre> element.
 */
function isInsideCodeElement(node: Node, editor: HTMLDivElement): boolean {
  let current: Node | null = node;
  while (current && current !== editor) {
    if (
      current.nodeName === 'CODE' ||
      current.nodeName === 'PRE' ||
      (current instanceof HTMLElement && current.contentEditable === 'false')
    ) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

/**
 * Replace the @mention text in the editor with the mention span.
 *
 * Selects the exact range of `@query` and replaces it with the mention element.
 */
export function insertMentionAtCursor(
  editor: HTMLDivElement,
  mention: MentionMatch,
  selection: MentionSelection
) {
  const { textNode, startOffset, endOffset } = mention;
  const range = document.createRange();

  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);

  const sel = window.getSelection();
  if (!sel) return;

  sel.removeAllRanges();
  sel.addRange(range);

  // Create a temporary container to parse the HTML
  const temp = document.createElement('div');
  temp.innerHTML = createMentionHtml(selection);

  const mentionElement = temp.firstChild;
  if (!mentionElement) return;

  // Delete the selected text and insert the mention element
  range.deleteContents();
  range.insertNode(mentionElement);

  // Add a space after the mention so the user can continue typing
  const spaceNode = document.createTextNode(' ');
  range.setStartAfter(mentionElement);
  range.collapse(true);
  range.insertNode(spaceNode);

  // Move cursor after the space
  const nextRange = document.createRange();
  nextRange.setStartAfter(spaceNode);
  nextRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(nextRange);
}

/**
 * Parse all mention spans from HTML content.
 */
export function parseMentionsFromHtml(html: string): MentionSelection[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const mentions: MentionSelection[] = [];

  doc.querySelectorAll('span[data-type="mention"]').forEach((el) => {
    const userId = el.getAttribute('data-user-id');
    const userName = el.getAttribute('data-user-name');

    if (userId && userName) {
      mentions.push({ userId, userName, type: 'user' });
    }
  });

  // Deduplicate by userId
  const seen = new Set<string>();
  return mentions.filter((m) => {
    if (seen.has(m.userId)) return false;
    seen.add(m.userId);
    return true;
  });
}

/**
 * Get the plain text representation of content with mentions,
 * replacing mention spans with @username for search indexing.
 */
export function mentionsToPlainText(html: string): string {
  return html.replace(
    /<span[^>]*data-type="mention"[^>]*data-user-name="([^"]*)"[^>]*>.*?<\/span>/g,
    '@$1'
  );
}
