const RECENT_EMOJIS_STORAGE_KEY = 'chat-app:recent-emojis';
export const MAX_RECENT_EMOJIS = 18;

export type SelectedEmoji = {
  native: string;
  unified?: string;
  id?: string;
  name?: string;
  shortcodes?: string;
};

export type RecentEmoji = {
  emoji: string;
  unified: string;
  name: string;
};

export function loadRecentEmojis() {
  try {
    const storedValue = window.localStorage.getItem(RECENT_EMOJIS_STORAGE_KEY);

    if (!storedValue) {
      return [];
    }

    const parsedValue: unknown = JSON.parse(storedValue);
    return Array.isArray(parsedValue) ? parsedValue.filter(isRecentEmoji).slice(0, MAX_RECENT_EMOJIS) : [];
  } catch {
    return [];
  }
}

export function persistRecentEmojis(emojis: RecentEmoji[]) {
  window.localStorage.setItem(RECENT_EMOJIS_STORAGE_KEY, JSON.stringify(emojis.slice(0, MAX_RECENT_EMOJIS)));
}

export function updateRecentEmojis(current: RecentEmoji[], emojiData: SelectedEmoji) {
  const unified = emojiData.unified || emojiData.id || emojiData.native;
  const nextEmoji: RecentEmoji = {
    emoji: emojiData.native,
    unified,
    name: emojiData.name || emojiData.shortcodes?.replace(/:/g, '') || 'emoji'
  };

  return [nextEmoji, ...current.filter((item) => item.unified !== unified)].slice(0, MAX_RECENT_EMOJIS);
}

function isRecentEmoji(value: unknown): value is RecentEmoji {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<RecentEmoji>;
  return typeof candidate.emoji === 'string' && typeof candidate.unified === 'string' && typeof candidate.name === 'string';
}
