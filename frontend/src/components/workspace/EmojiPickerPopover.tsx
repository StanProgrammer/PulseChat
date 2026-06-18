import { Suspense, lazy, memo, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { RecentEmoji, SelectedEmoji } from './recentEmojis';

const EmojiPicker = lazy(async () => {
  const [{ default: Picker }, { default: data }] = await Promise.all([
    import('@emoji-mart/react'),
    import('@emoji-mart/data')
  ]);

  return {
    default: function LazyEmojiPicker(props: Record<string, unknown>) {
      return <Picker data={data} {...props} />;
    }
  };
});

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

  useEffect(() => {
    const searchInput = popoverRef.current?.querySelector<HTMLInputElement>('input[type="search"], input[aria-label*="Search" i]');
    searchInput?.focus();
  }, []);

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

  return (
    <div aria-label="Choose an emoji" className="emoji-popover" data-testid="emoji-picker-popover" id={id} ref={popoverRef} role="dialog">
      <header className="emoji-popover-header">
        <div>
          <p className="emoji-popover-eyebrow">Message tools</p>
          <h3>Choose an emoji</h3>
        </div>
        <button aria-label="Close emoji picker" className="emoji-popover-close" onClick={onClose} type="button">
          <span aria-hidden="true">×</span>
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
        <Suspense fallback={<EmojiPickerLoading />}>
          <EmojiPicker
            autoFocus
            className="composer-emoji-picker"
            dynamicWidth
            emojiButtonColors={['rgba(97, 31, 105, 0.1)', 'rgba(46, 182, 125, 0.11)', 'rgba(18, 100, 163, 0.1)']}
            emojiButtonRadius="8px"
            emojiButtonSize={36}
            emojiSize={24}
            exceptEmojis={[]}
            maxFrequentRows={2}
            navPosition="top"
            noCountryFlags={false}
            onEmojiSelect={onEmojiSelect}
            perLine={9}
            previewPosition="bottom"
            searchPosition="sticky"
            set="native"
            skinTonePosition="search"
            theme="auto"
          />
        </Suspense>
      </div>

      <footer className="emoji-popover-footer">
        <span>Frequently used adapts as you chat</span>
        <kbd>Esc</kbd>
      </footer>
    </div>
  );
}

function EmojiPickerLoading() {
  return (
    <div aria-live="polite" className="emoji-picker-loading">
      <span className="emoji-picker-loading-mark" />
      <span>Loading emoji…</span>
    </div>
  );
}

export default memo(EmojiPickerPopover);
