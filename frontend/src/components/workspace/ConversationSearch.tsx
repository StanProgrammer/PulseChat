import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

export type ConversationSearchHandle = {
  focus: () => void;
};

type ConversationSearchProps = {
  /** Whether the search UI is currently visible. */
  isOpen: boolean;
  /** Called to close the search. */
  onClose: () => void;
  /** Current search query string. */
  query: string;
  /** Called when the user types in the search input. */
  onQueryChange: (query: string) => void;
  /** Total number of matching messages. */
  totalMatches: number;
  /** Zero-based index of the currently active match. */
  activeMatchIndex: number;
  /** Navigate to the next match. */
  onNavigateNext: () => void;
  /** Navigate to the previous match. */
  onNavigatePrev: () => void;
  /** Whether a search request is in-flight. */
  isSearching: boolean;
  /** Whether at least one search has been completed (for showing empty state). */
  hasSearched: boolean;
  /** Optional class name for layout overrides. */
  className?: string;
};

/**
 * Collapsible conversation search bar.
 * Designed to be reusable for Channels with minimal prop changes.
 */
const ConversationSearch = forwardRef<ConversationSearchHandle, ConversationSearchProps>(function ConversationSearch({
  isOpen,
  onClose,
  query,
  onQueryChange,
  totalMatches,
  activeMatchIndex,
  onNavigateNext,
  onNavigatePrev,
  isSearching,
  hasSearched,
  className = ''
}, ref) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus()
  }), []);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Small delay to let animation start
      const id = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (totalMatches === 0) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onNavigatePrev();
      } else {
        onNavigateNext();
      }
    }
  }, [onClose, onNavigateNext, onNavigatePrev, totalMatches]);

  return (
    <div
      aria-hidden={!isOpen}
      className={`cs-bar ${isOpen ? 'cs-bar-open' : 'cs-bar-closed'} ${className}`}
      onKeyDown={handleKeyDown}
    >
      <div className="cs-bar-body">
        <div className="cs-input-wrapper">
          <svg
            className="cs-search-icon"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="M13 13l4 4" />
          </svg>
          <input
            ref={inputRef}
            aria-label="Search messages"
            autoComplete="off"
            className="cs-input"
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search this conversation…"
            type="text"
            value={query}
          />
          {query && (
            <button
              aria-label="Clear search"
              className="cs-clear-btn"
              onClick={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
              tabIndex={-1}
              type="button"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8m0-8l-8 8" />
              </svg>
            </button>
          )}
        </div>

        {/* Match status bar */}
        {query.trim() && (
          <div className="cs-bar-status">
            <div className="cs-bar-status-left">
              {isSearching ? (
                <span className="cs-status-text">Searching…</span>
              ) : hasSearched && totalMatches === 0 ? (
                <span className="cs-status-text cs-status-empty">
                  No messages found. Try another keyword.
                </span>
              ) : totalMatches > 0 ? (
                <span className="cs-status-text">
                  <span className="cs-match-count">
                    {activeMatchIndex + 1} of {totalMatches}
                  </span>
                  {totalMatches === 1 ? ' match' : ' matches'}
                </span>
              ) : null}
            </div>

            {totalMatches > 0 && (
              <div className="cs-bar-status-right">
                <button
                  aria-label="Previous match (Shift+Enter)"
                  className="cs-nav-btn"
                  disabled={totalMatches === 0}
                  onClick={onNavigatePrev}
                  tabIndex={-1}
                  title="Previous (Shift+Enter)"
                  type="button"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 4l-4 4 4 4" />
                  </svg>
                </button>
                <button
                  aria-label="Next match (Enter)"
                  className="cs-nav-btn"
                  disabled={totalMatches === 0}
                  onClick={onNavigateNext}
                  tabIndex={-1}
                  title="Next (Enter)"
                  type="button"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Close button */}
      <button
        aria-label="Close search"
        className="cs-bar-close"
        onClick={onClose}
        title="Close search (Esc)"
        type="button"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 4l8 8m0-8l-8 8" />
        </svg>
      </button>
    </div>
  );
});

ConversationSearch.displayName = 'ConversationSearch';

export default ConversationSearch;
