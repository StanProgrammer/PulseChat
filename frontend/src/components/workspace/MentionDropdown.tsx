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
  /** The editor element — used to compute cursor position */
  editorElement: HTMLDivElement | null;
};

const SEARCH_DEBOUNCE_MS = 150;
const DROPDOWN_WIDTH = 320;
const DROPDOWN_HEIGHT = 288;
const GAP = 6;

/**
 * Compute fixed-position style for the dropdown so it appears
 * near the cursor while staying within the viewport.
 * Returns both the style and whether the dropdown is placed above the cursor.
 */
function getDropdownPosition(rect: DOMRect): { style: React.CSSProperties; above: boolean } {
  let left = Math.round(rect.left);
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

  return {
    style: {
      position: 'fixed',
      left,
      top,
      zIndex: 100
    },
    above
  };
}

export default function MentionDropdown({
  accessToken,
  query,
  onSelect,
  onClose,
  excludeUserIds = [],
  editorElement
}: MentionDropdownProps) {
  const [results, setResults] = useState<Teammate[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [positionStyle, setPositionStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [positionAbove, setPositionAbove] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Compute position from the current selection in a layout effect
  // so the dropdown is positioned before the browser paints.
  // Re-runs when query changes so the dropdown tracks the cursor as the user types.
  useLayoutEffect(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorElement && editorElement.contains(range.commonAncestorContainer)) {
        const rect = range.getBoundingClientRect();
        if (rect && rect.width >= 0 && rect.height >= 0) {
          const { style, above } = getDropdownPosition(rect);
          setPositionStyle(style);
          setPositionAbove(above);
          return;
        }
      }
    }
    // Fallback: position relative to the editor
    if (editorElement) {
      const rect = editorElement.getBoundingClientRect();
      setPositionStyle({
        position: 'fixed',
        left: Math.max(8, Math.round(rect.left + 8)),
        top: Math.max(8, Math.round(rect.top - 8 - 288)),
        zIndex: 100
      });
      setPositionAbove(true);
    }
  }, [editorElement, query]);

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
      <div className={`mention-dropdown-connector${positionAbove ? ' mention-dropdown-connector-above' : ''}`} />
      {dropdownContent}
    </div>
  );

  return createPortal(menu, document.body);
}
