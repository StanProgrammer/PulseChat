import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Teammate } from '../../api/messaging';
import { searchMentionableUsers } from '../../api/messaging';
import Avatar from './Avatar';
import { escapeHtml, getInitials } from './messageUtils';
import type { MentionSelection } from './mentionUtils';

type MentionDropdownProps = {
  accessToken: string;
  query: string;
  onSelect: (mention: MentionSelection) => void;
  onClose: () => void;
  /** Users to exclude from the list (e.g., self) */
  excludeUserIds?: string[];
  /** The editor element — used as fallback for positioning */
  editorElement: HTMLDivElement | null;
  /** Cursor bounding rect captured at the moment the mention was detected.
   *  Provides reliable positioning without re-reading window.getSelection()
   *  (which can be stale by the time the effect runs). */
  cursorRect: DOMRect | null;
};

const SEARCH_DEBOUNCE_MS = 150;
const DROPDOWN_WIDTH = 320;
const DROPDOWN_HEIGHT = 288;
const GAP = 6;
/** Offset from the cursor to the dropdown's left edge, so the connector
 *  triangle has room to appear directly below/above the cursor. */
const CURSOR_OFFSET = 10;
const CONNECTOR_WIDTH = 10;
const CONNECTOR_HALF = CONNECTOR_WIDTH / 2;

/**
 * Compute fixed-position style for the dropdown so it appears
 * near the cursor while staying within the viewport.
 * Returns the style, whether the dropdown is placed above the cursor,
 * and the horizontal offset (px) for the connector triangle's left edge
 * relative to the dropdown.
 */
function getDropdownPosition(rect: DOMRect): {
  style: React.CSSProperties;
  above: boolean;
  /** The connector's `left` CSS value relative to the dropdown */
  connectorLeft: number;
} {
  // Position the dropdown so the connector can sit directly below the cursor.
  // The cursor is at `rect.left` (collapsed range→0 width, but some UAs return
  // a tiny rect). We inset the dropdown a bit so the connector is visible.
  let left = Math.round(rect.left - CURSOR_OFFSET);
  let top = Math.round(rect.bottom + GAP);
  let above = false;

  // Prevent right-edge overflow
  const rightOverflow = left + DROPDOWN_WIDTH - window.innerWidth + 8;
  if (rightOverflow > 0) {
    left = Math.max(8, left - rightOverflow);
  }

  // Prevent left-edge underflow
  if (left < 8) {
    left = 8;
  }

  // If near bottom of viewport, show above the cursor
  const bottomSpace = window.innerHeight - (rect.bottom + GAP);
  if (bottomSpace < DROPDOWN_HEIGHT) {
    const spaceAbove = rect.top - GAP;
    if (spaceAbove >= DROPDOWN_HEIGHT || spaceAbove > bottomSpace) {
      top = Math.max(8, Math.round(rect.top - GAP - DROPDOWN_HEIGHT));
      above = true;
    }
  }

  // Calculate where the cursor center falls relative to the dropdown's left edge
  const cursorCenterInDropdown = rect.left - left + rect.width / 2;
  // The connector's left edge should center on the cursor
  let connectorLeft = Math.round(cursorCenterInDropdown - CONNECTOR_HALF);
  // Clamp so the connector stays visibly within the dropdown's bounds
  connectorLeft = Math.max(6, Math.min(connectorLeft, DROPDOWN_WIDTH - CONNECTOR_WIDTH - 6));

  return {
    style: {
      position: 'fixed',
      left,
      top,
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
  editorElement,
  cursorRect
}: MentionDropdownProps) {
  const [results, setResults] = useState<Teammate[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [positionStyle, setPositionStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [positionAbove, setPositionAbove] = useState(false);
  const [connectorLeft, setConnectorLeft] = useState<number>(14);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Compute position from the cursor rect captured at detection time.
  // This avoids any timing issues with re-reading window.getSelection()
  // (which may be stale by the time the layout effect runs).
  // Re-runs when cursorRect changes so the position tracks the cursor.
  useLayoutEffect(() => {
    if (cursorRect && cursorRect.width >= 0 && cursorRect.height >= 0) {
      const { style, above, connectorLeft } = getDropdownPosition(cursorRect);
      const originY = above ? 'bottom' : 'top';
      setPositionStyle({ ...style, transformOrigin: `${connectorLeft + 5}px ${originY}` });
      setPositionAbove(above);
      setConnectorLeft(connectorLeft);
      return;
    }

    // Fallback: try window.getSelection() as a second attempt
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorElement && editorElement.contains(range.commonAncestorContainer)) {
        const rect = range.getBoundingClientRect();
        if (rect && rect.width >= 0 && rect.height >= 0) {
          const { style, above, connectorLeft } = getDropdownPosition(rect);
          const originY = above ? 'bottom' : 'top';
          setPositionStyle({ ...style, transformOrigin: `${connectorLeft + 5}px ${originY}` });
          setPositionAbove(above);
          setConnectorLeft(connectorLeft);
          return;
        }
      }
    }

    // Final fallback: position relative to the editor
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
  }, [cursorRect, editorElement, query]);

  useEffect(() => {
    if (!query) {
      // Show all users when query is empty (just typed @)
      searchUsers(' ');
      return;
    }

    searchUsers(query);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, accessToken]);

  const searchUsers = (searchQuery: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setLoading(true);

    searchTimeoutRef.current = setTimeout(() => {
      searchMentionableUsers(accessToken, searchQuery)
        .then((response) => {
          const filtered = response.users.filter(
            (user) => !excludeUserIds.includes(user.id)
          );
          setResults(filtered);
          setActiveIndex(0);
        })
        .catch(() => {
          setResults([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
  }

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
  const rawQuery = !query ? '' : query;
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
          ? `<strong class="mention-match">${escapeHtml(part)}</strong>`
          : escapeHtml(part)
      )
      .join('');
  };

  const dropdownContent = loading && results.length === 0 ? (
    <div className="mention-dropdown-loading">Searching…</div>
  ) : !loading && results.length === 0 ? (
    <div className="mention-dropdown-empty">No users found</div>
  ) : (
    <div ref={listRef}>
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
