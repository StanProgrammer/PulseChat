import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Teammate } from '../../api/messaging';
import { searchMentionableUsers } from '../../api/messaging';
import Avatar from './Avatar';
import { escapeHtml, getInitials } from './messageUtils';
import { normalizeMentionQuery, type MentionSelection } from './mentionUtils';

type MentionDropdownProps = {
  accessToken: string;
  query: string;
  onSelect: (mention: MentionSelection) => void;
  onClose: () => void;
  /** Users to exclude from the list (e.g., self) */
  excludeUserIds?: string[];
  conversationId?: string;
  /** The editor element — used as fallback for positioning */
  editorElement: HTMLDivElement | null;
  /** Cursor bounding rect captured at the moment the mention was detected.
   *  Provides reliable positioning without re-reading window.getSelection()
   *  (which can be stale by the time the effect runs). */
  cursorRect: DOMRect | null;
};

const SEARCH_DEBOUNCE_MS = 150;
const DROPDOWN_WIDTH = 320;
const GAP = 6;
const MAX_VISIBLE_ITEMS = 7;
/** Approx height per item (padding + avatar + gap) */
const ITEM_HEIGHT = 44;
/** Extra padding inside the results container (top + bottom) */
const RESULTS_PADDING = 16;
const MAX_DROPDOWN_HEIGHT = MAX_VISIBLE_ITEMS * ITEM_HEIGHT + RESULTS_PADDING;
/** Minimum content height when there are no results (loading / empty state) */
const MIN_CONTENT_HEIGHT = 48;
/** Offset from the cursor to the dropdown's left edge, so the connector
 *  triangle has room to appear directly below/above the cursor. */
const CURSOR_OFFSET = 10;
const CONNECTOR_WIDTH = 10;
const CONNECTOR_HEIGHT = 5;
const CONNECTOR_HALF = CONNECTOR_WIDTH / 2;

/** Compute fixed-position style near cursor, clamped to viewport. */
function getDropdownPosition(
  rect: DOMRect,
  contentHeight: number
): {
  style: React.CSSProperties;
  above: boolean;
  /** The connector's `left` CSS value relative to the dropdown */
  connectorLeft: number;
} {
  let left = Math.round(rect.left - CURSOR_OFFSET);
  let top: number | undefined = Math.round(rect.bottom + GAP);
  let bottom: number | undefined;
  let above = false;

  // Clamp to viewport edges
  const rightOverflow = left + DROPDOWN_WIDTH - window.innerWidth + 8;
  if (rightOverflow > 0) {
    left = Math.max(8, left - rightOverflow);
  }

  if (left < 8) {
    left = 8;
  }

  const dropdownHeight = Math.min(contentHeight, MAX_DROPDOWN_HEIGHT);
  const totalHeight = dropdownHeight + CONNECTOR_HEIGHT;

  // Flip above if not enough space below
  const bottomSpace = window.innerHeight - (rect.bottom + GAP);
  if (bottomSpace < totalHeight) {
    const spaceAbove = rect.top - GAP;
    if (spaceAbove >= totalHeight || spaceAbove > bottomSpace) {
      top = undefined;
      bottom = Math.max(8, Math.round(window.innerHeight - rect.top + GAP));
      above = true;
    }
  }

  const cursorCenterInDropdown = rect.left - left + rect.width / 2;
  let connectorLeft = Math.round(cursorCenterInDropdown - CONNECTOR_HALF);
  // Keep connector visible within dropdown bounds
  connectorLeft = Math.max(6, Math.min(connectorLeft, DROPDOWN_WIDTH - CONNECTOR_WIDTH - 6));

  return {
    style: {
      position: 'fixed',
      left,
      top,
      bottom,
      zIndex: 100
    },
    above,
    connectorLeft
  };
}

export default function MentionDropdown({
  accessToken,
  query,
  onSelect,
  onClose,
  excludeUserIds = [],
  conversationId,
  editorElement,
  cursorRect
}: MentionDropdownProps) {
  const [results, setResults] = useState<Teammate[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [positionStyle, setPositionStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [positionAbove, setPositionAbove] = useState(false);
  const [connectorLeft, setConnectorLeft] = useState<number>(14);
  const [contentHeight, setContentHeight] = useState(MIN_CONTENT_HEIGHT);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestRequestRef = useRef(0);
  

  // Position from captured cursor rect to avoid stale getSelection() reads
  useLayoutEffect(() => {
    if (cursorRect && cursorRect.width >= 0 && cursorRect.height >= 0) {
      const { style, above, connectorLeft } = getDropdownPosition(cursorRect, contentHeight);
      const originY = above ? 'bottom' : 'top';
      setPositionStyle({ ...style, transformOrigin: `${connectorLeft + 5}px ${originY}` });
      setPositionAbove(above);
      setConnectorLeft(connectorLeft);
      return;
    }

    // Fallback: window.getSelection()
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorElement && editorElement.contains(range.commonAncestorContainer)) {
        const rect = range.getBoundingClientRect();
        if (rect && rect.width >= 0 && rect.height >= 0) {
          const { style, above, connectorLeft } = getDropdownPosition(rect, contentHeight);
          const originY = above ? 'bottom' : 'top';
          setPositionStyle({ ...style, transformOrigin: `${connectorLeft + 5}px ${originY}` });
          setPositionAbove(above);
          setConnectorLeft(connectorLeft);
          return;
        }
      }
    }

    // Fallback: position relative to editor
    if (editorElement) {
      const rect = editorElement.getBoundingClientRect();
      const fallbackConnectorLeft = 14;
      // Position below the editor instead of above
      setPositionStyle({
        position: 'fixed',
        left: Math.max(8, Math.round(rect.left + 8)),
        top: Math.round(rect.bottom + 6),
        zIndex: 100,
        transformOrigin: `${fallbackConnectorLeft + 5}px top`
      });
      setPositionAbove(false);
      setConnectorLeft(fallbackConnectorLeft);
    }
  }, [cursorRect, editorElement, query, contentHeight]);

  // Measure the actual content height whenever results change
  useEffect(() => {
    if (listRef.current) {
      const itemsHeight = listRef.current.scrollHeight;
      const newHeight = itemsHeight + RESULTS_PADDING;
      setContentHeight(Math.max(MIN_CONTENT_HEIGHT, newHeight));
    }
  }, [results.length]);

  useEffect(() => {
    const normalizedQuery = normalizeMentionQuery(query);

    const cleanup = () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      abortControllerRef.current?.abort();
    };

    if (!normalizedQuery) {
      // Show all users when query is empty (just typed @)
      searchUsers(' ');
      return cleanup;
    }

    searchUsers(normalizedQuery);
    return cleanup;
  }, [query, accessToken, conversationId]);

  const searchUsers = (searchQuery: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    abortControllerRef.current?.abort();

    setLoading(true);

    searchTimeoutRef.current = setTimeout(() => {
      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      searchMentionableUsers(accessToken, searchQuery, conversationId, controller.signal)
        .then((response) => {
          if (latestRequestRef.current !== requestId) return;
          const filtered = response.users.filter(
            (user) => !excludeUserIds.includes(user.id)
          );
          setResults(filtered);
          setActiveIndex(0);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
          if (latestRequestRef.current !== requestId) return;
          setResults([]);
        })
        .finally(() => {
          if (latestRequestRef.current !== requestId) return;
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
  };

  const selectItem = useCallback(
    (index: number) => {
      const user = results[index];
      if (!user) return;

      onSelect({
        userId: user.id,
        userName: user.name,
        type: 'user'
      });
    },
    [results, onSelect]
  );

  // Scrolling with keyboard
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          setActiveIndex((prev) => {
            const next = Math.min(prev + 1, results.length - 1);
            scrollIntoView(next);
            return next;
          });
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          setActiveIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            scrollIntoView(next);
            return next;
          });
          break;
        }
        case 'Enter':
        case 'Tab': {
          event.preventDefault();
          selectItem(activeIndex);
          break;
        }
        case 'Escape': {
          event.preventDefault();
          onClose();
          break;
        }
      }
    },
    [results, activeIndex, selectItem, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  function scrollIntoView(index: number) {
    const container = listRef.current;
    if (!container) return;
    const item = container.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  // The raw query text (what the user typed after @)
  const rawQuery = query ? normalizeMentionQuery(query) : '';
  // Escape for regex safety when splitting the name
  const escapedQuery = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const splitRegex = escapedQuery ? new RegExp(`(${escapedQuery})`, 'gi') : null;
  const queryLower = rawQuery.toLowerCase();

  /** Highlight the matching portion of a name. Uses case-insensitive
   *  string comparison to avoid stateful regex .test() gotchas. */
  const highlightName = (name: string) => {
    if (!splitRegex) return escapeHtml(name);
    const parts = name.split(splitRegex);
    if (parts.length === 1) return escapeHtml(name);
    return parts
      .filter(Boolean)
      .map((part) =>
        part.toLowerCase() === queryLower
          ? '<strong class="mention-match">' + escapeHtml(part) + '</strong>'
          : escapeHtml(part)
      )
      .join('');
  };

  const dropdownContent = loading && results.length === 0 ? (
    <div className="mention-dropdown-loading">Searching…</div>
  ) : !loading && results.length === 0 ? (
    <div className="mention-dropdown-empty">No users found</div>
  ) : (
    <div
      ref={listRef}
      className="mention-dropdown-results"
      style={{
        maxHeight: MAX_DROPDOWN_HEIGHT,
        overflowY: 'auto',
        overflowX: 'hidden'
      }}
    >
      {results.map((user, index) => {
        const highlighted = highlightName(user.name);
        return (
          <button
            className={`mention-dropdown-item ${index === activeIndex ? 'mention-dropdown-item-active' : ''}`}
            key={user.id}
            onMouseDown={(event) => {
              event.preventDefault();
              selectItem(index);
            }}
            onMouseEnter={() => setActiveIndex(index)}
            role="option"
            aria-selected={index === activeIndex}
            type="button"
          >
            <Avatar initials={getInitials(user.name)} size="xs" />
            <span
              className="mention-dropdown-name"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
            <span className="mention-dropdown-email">{user.email}</span>
          </button>
        );
      })}
    </div>
  );

  const menu = (
    <div
      className={`mention-dropdown mention-dropdown-fixed${positionAbove ? ' mention-dropdown-above' : ''}`}
      role="listbox"
      aria-label="Suggested users"
      style={positionStyle}
    >
      {/* Visual connector triangle pointing toward the cursor */}
      <div
        className={`mention-dropdown-connector${positionAbove ? ' mention-dropdown-connector-above' : ''}`}
        style={{ left: connectorLeft }}
      />
      {dropdownContent}
    </div>
  );

  return createPortal(menu, document.body);
}
