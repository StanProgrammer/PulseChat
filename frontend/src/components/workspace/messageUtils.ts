import DOMPurify from 'dompurify';
import type { DirectConversation, DirectMessage } from '../../api/messaging';
import type { RealtimeMessage, SocketStatus } from './types';

const MESSAGE_HTML_TAGS = ['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'span'];

export function upsertConversation(conversations: DirectConversation[], conversation: DirectConversation) {
  return [conversation, ...conversations.filter((item) => item.id !== conversation.id)];
}

export function mergeRealtimeMessage(messages: RealtimeMessage[], serverMessage: DirectMessage, clientMessageId?: string) {
  const existingIndex = messages.findIndex((message) => message.id === serverMessage.id || (clientMessageId && message.clientMessageId === clientMessageId));

  if (existingIndex === -1) {
    return [...messages, { ...serverMessage, status: 'sent' as const }];
  }

  return messages.map((message, index) => (index === existingIndex ? { ...serverMessage, status: 'sent' as const } : message));
}

export function markMessageFailed(messages: RealtimeMessage[], clientMessageId: string) {
  return messages.map((message) => (message.clientMessageId === clientMessageId ? { ...message, status: 'failed' as const } : message));
}

export function createClientMessageId() {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return 'PC';
  }

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export function formatMessageTime(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(date));
}

const MAX_PREVIEW_LENGTH = 100;

export function formatMessagePreview(content: string) {
  if (!content.trim()) {
    return '';
  }

  const element = document.createElement('div');
  element.innerHTML = sanitizeMessageHtml(content);
  const text = element.textContent?.trim() || 'Rich text message';

  if (text.length <= MAX_PREVIEW_LENGTH) {
    return text;
  }

  // Cut at a word boundary for a clean preview
  const truncated = text.slice(0, MAX_PREVIEW_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  const cutoff = lastSpace > MAX_PREVIEW_LENGTH * 0.7 ? lastSpace : MAX_PREVIEW_LENGTH;
  return truncated.slice(0, cutoff).trimEnd() + '…';
}

export function sanitizeMessageHtml(content: string) {
  const sanitized = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: MESSAGE_HTML_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel', 'data-type', 'data-id', 'data-user-id', 'data-user-name', 'data-channel-id', 'contenteditable', 'class'],
    ALLOW_DATA_ATTR: true
  });
  const element = document.createElement('div');
  element.innerHTML = sanitized;

  element.querySelectorAll('a').forEach((link) => {
    const href = normalizeLinkUrl(link.getAttribute('href') || '');

    if (!href) {
      link.replaceWith(document.createTextNode(link.textContent || ''));
      return;
    }

    link.setAttribute('href', href);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });

  return element.innerHTML;
}

export function normalizeLinkUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;

  try {
    const url = new URL(withProtocol);
    const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:'];

    return allowedProtocols.includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function createLinkHtml(text: string, href: string) {
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

export function escapeHtml(content: string) {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function socketStatusLabel(status: SocketStatus) {
  const labels: Record<SocketStatus, string> = {
    connecting: 'Connecting',
    connected: 'Realtime on',
    disconnected: 'Reconnecting',
    error: 'Realtime offline'
  };

  return labels[status];
}
