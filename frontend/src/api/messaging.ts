import { apiRequest, authHeaders } from './auth';

export type Teammate = {
  id: string;
  name: string;
  email: string;
  workspaceName: string;
  avatar?: string | null;
};

export type DirectConversation = {
  id: string;
  type: 'DIRECT';
  createdAt: string;
  updatedAt: string;
  participant: Teammate | null;
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    sender: Teammate;
  } | null;
};

export type DirectMessage = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sender: Teammate;
};

export function searchWorkspaceUsers(accessToken: string, query: string) {
  return apiRequest<{ users: Teammate[] }>(`/messaging/users/search?query=${encodeURIComponent(query)}`, {
    headers: authHeaders(accessToken)
  });
}

export function listDirectConversations(accessToken: string) {
  return apiRequest<{ conversations: DirectConversation[] }>('/messaging/direct-conversations', {
    headers: authHeaders(accessToken)
  });
}

export function startDirectConversation(accessToken: string, userId: string) {
  return apiRequest<{ conversation: DirectConversation }>('/messaging/direct-conversations', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ userId })
  });
}

export function listDirectMessages(accessToken: string, conversationId: string) {
  return apiRequest<{ messages: DirectMessage[] }>(`/messaging/direct-conversations/${conversationId}/messages`, {
    headers: authHeaders(accessToken)
  });
}

export function sendDirectMessage(accessToken: string, conversationId: string, content: string) {
  return apiRequest<{ message: DirectMessage }>(`/messaging/direct-conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ content })
  });
}
