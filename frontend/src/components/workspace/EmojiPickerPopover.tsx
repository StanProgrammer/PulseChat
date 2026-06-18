import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import emojiMartData from '@emoji-mart/data';
import type { Emoji, EmojiMartData } from '@emoji-mart/data';
import type { RecentEmoji, SelectedEmoji } from './recentEmojis';

const emojiData = emojiMartData as EmojiMartData;

type EmojiCategoryId = 'people' | 'nature' | 'foods' | 'activity' | 'places' | 'objects' | 'symbols' | 'flags';

type EmojiCategory = {
  id: EmojiCategoryId;
  label: string;
  icon: string;
};

type EmojiOption = {
  categoryId: EmojiCategoryId;
  id: string;
  keywords: string[];
  name: string;
  native: string;
  searchText: string;
  unified: string;
};

const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: 'people', label: 'Smileys', icon: '😀' },
  { id: 'nature', label: 'Animals', icon: '🐻' },
  { id: 'foods', label: 'Food', icon: '🍕' },
  { id: 'activity', label: 'Activities', icon: '⚽' },
  { id: 'places', label: 'Travel', icon: '✈️' },
  { id: 'objects', label: 'Objects', icon: '💡' },
  { id: 'symbols', label: 'Symbols', icon: '❤️' },
  { id: 'flags', label: 'Flags', icon: '🏳️' }
];

const CATEGORY_BY_ID = new Map(EMOJI_CATEGORIES.map((category) => [category.id, category]));

type EmojiPickerPopoverProps = {
  id: string;
  onClose: () => void;
  onEmojiSelect: (emoji: SelectedEmoji) => void;
  onRecentEmojiSelect: (emoji: RecentEmoji) => void;
  recentEmojis: RecentEmoji[];
};

function EmojiPickerPopover({
  id,
  onClose,
  onEmojiSelect,
  onRecentEmojiSelect,
  recentEmojis
}: EmojiPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const recentEmojisRef = useRef<HTMLDivElement | null>(null);
  const categoryNavRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const emojiGridRef = useRef<HTMLDivElement | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<EmojiCategoryId>('people');
  const [searchQuery, setSearchQuery] = useState('');

  const emojiOptions = useMemo(() => buildEmojiOptions(), []);
  const activeCategory = CATEGORY_BY_ID.get(activeCategoryId) || EMOJI_CATEGORIES[0];
  const activeCategoryTotal = emojiOptions.filter((emoji) => emoji.categoryId === activeCategoryId).length;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();

  const visibleEmojis = useMemo(() => {
    return emojiOptions.filter((emoji) => {
      if (emoji.categoryId !== activeCategoryId) {
        return false;
      }

      return normalizedSearchQuery.length === 0 || emoji.searchText.includes(normalizedSearchQuery);
    });
  }, [activeCategoryId, emojiOptions, normalizedSearchQuery]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    emojiGridRef.current?.scrollTo({ top: 0 });
  }, [activeCategoryId, normalizedSearchQuery]);

  const handleRecentEmojiKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    const buttons = Array.from(recentEmojisRef.current?.querySelectorAll<HTMLButtonElement>('button') || []);
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = activeIndex === -1 ? 0 : (activeIndex + direction + buttons.length) % buttons.length;

    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  const handleCategoryKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }

    const buttons = Array.from(categoryNavRef.current?.querySelectorAll<HTMLButtonElement>('button') || []);
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = activeIndex;

    if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = buttons.length - 1;
    } else {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      nextIndex = activeIndex === -1 ? 0 : (activeIndex + direction + buttons.length) % buttons.length;
    }

    event.preventDefault();
    buttons[nextIndex]?.focus();
    buttons[nextIndex]?.click();
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handleEmojiSelect = (emoji: EmojiOption) => {
    onEmojiSelect({
      id: emoji.id,
      name: emoji.name,
      native: emoji.native,
      shortcodes: `:${emoji.id}:`,
      unified: emoji.unified
    });
  };

  return (
    <div aria-label="Choose an emoji" className="emoji-popover" data-testid="emoji-picker-popover" id={id} ref={popoverRef} role="dialog">
      <header className="emoji-popover-header">
        <div>
          <p className="emoji-popover-eyebrow">Message tools</p>
          <h3>Choose an emoji</h3>
        </div>
        <button aria-label="Close emoji picker" className="emoji-popover-close" onClick={onClose} type="button">
          <span aria-hidden="true">x</span>
        </button>
      </header>

      {recentEmojis.length > 0 && (
        <section aria-label="Recently used emojis" className="emoji-recents">
          <div className="emoji-recents-header">
            <p>Recently used</p>
            <span>{recentEmojis.length}</span>
          </div>
          <div aria-label="Recently used emojis" className="emoji-recents-row" onKeyDown={handleRecentEmojiKeyDown} ref={recentEmojisRef} role="toolbar">
            {recentEmojis.map((item) => (
              <button
                aria-label={`Insert ${item.name}`}
                className="emoji-recent-button"
                key={item.unified}
                onClick={() => onRecentEmojiSelect(item)}
                title={item.name}
                type="button"
              >
                <span aria-hidden="true">{item.emoji}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="emoji-picker-shell">
        <label className="emoji-search">
          <span className="sr-only">Search emojis in {activeCategory.label}</span>
          <input
            aria-describedby="emoji-category-status"
            onChange={handleSearchChange}
            placeholder={`Search ${activeCategory.label.toLowerCase()}`}
            ref={searchInputRef}
            type="search"
            value={searchQuery}
          />
        </label>

        <div aria-label="Emoji categories" className="emoji-category-nav" onKeyDown={handleCategoryKeyDown} ref={categoryNavRef} role="tablist">
          {EMOJI_CATEGORIES.map((category) => {
            const isActive = category.id === activeCategoryId;

            return (
              <button
                aria-controls="emoji-grid"
                aria-label={`Show ${category.label} emojis`}
                aria-selected={isActive}
                className={`emoji-category-button ${isActive ? 'emoji-category-button-active' : ''}`}
                data-testid={`emoji-category-${category.id}`}
                key={category.id}
                onClick={() => setActiveCategoryId(category.id)}
                role="tab"
                title={category.label}
                type="button"
              >
                <span aria-hidden="true">{category.icon}</span>
                <span>{category.label}</span>
              </button>
            );
          })}
        </div>

        <div className="emoji-category-status" id="emoji-category-status">
          <span>{activeCategory.label}</span>
          <span>
            Showing {visibleEmojis.length} of {activeCategoryTotal}
          </span>
        </div>

        <div aria-label={`${activeCategory.label} emojis`} className="emoji-grid" data-testid="emoji-grid" id="emoji-grid" ref={emojiGridRef} role="tabpanel">
          {visibleEmojis.length > 0 ? (
            visibleEmojis.map((emoji) => (
              <button
                aria-label={`Insert ${emoji.name}`}
                className="emoji-grid-button"
                data-category={emoji.categoryId}
                data-emoji-id={emoji.id}
                key={`${emoji.categoryId}-${emoji.id}`}
                onClick={() => handleEmojiSelect(emoji)}
                title={emoji.name}
                type="button"
              >
                <span aria-hidden="true">{emoji.native}</span>
              </button>
            ))
          ) : (
            <p className="emoji-empty-state">No {activeCategory.label.toLowerCase()} emojis match this search.</p>
          )}
        </div>
      </div>

      <footer className="emoji-popover-footer">
        <span>Category changes filter instantly</span>
        <kbd>Esc</kbd>
      </footer>
    </div>
  );
}

function buildEmojiOptions() {
  return emojiData.categories.flatMap((category) => {
    const categoryId = category.id as EmojiCategoryId;

    if (!CATEGORY_BY_ID.has(categoryId)) {
      return [];
    }

    return category.emojis.flatMap((emojiId) => {
      const emoji = emojiData.emojis[emojiId];
      const skin = getDefaultEmojiSkin(emoji);

      if (!emoji || !skin?.native) {
        return [];
      }

      const keywords = emoji.keywords || [];

      return {
        categoryId,
        id: emoji.id,
        keywords,
        name: emoji.name,
        native: skin.native,
        searchText: [emoji.id, emoji.name, ...keywords, ...(emoji.emoticons || [])].join(' ').toLocaleLowerCase(),
        unified: skin.unified
      };
    });
  });
}

function getDefaultEmojiSkin(emoji: Emoji | undefined) {
  return emoji?.skins?.[0];
}

export default memo(EmojiPickerPopover);
