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

export type AttachmentInfo = {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  publicId: string;
  resourceType: string;
  fileType: 'image' | 'document';
  uploaderId: string;
  createdAt: string;
};

export type DirectMessage = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sender: Teammate;
  attachments: AttachmentInfo[];
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

export function sendDirectMessage(accessToken: string, conversationId: string, content: string, attachmentIds?: string[]) {
  return apiRequest<{ message: DirectMessage }>(`/messaging/direct-conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ content, attachmentIds })
  });
}

export function uploadFile(accessToken: string, file: File, onProgress?: (percent: number) => void) {
  return new Promise<{ attachment: AttachmentInfo }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid upload response.'));
        }
      } else {
        try {
          const errorBody = JSON.parse(xhr.responseText);
          reject(new Error(errorBody.message || `Upload failed (${xhr.status}).`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status}).`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed due to a network error.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled.')));

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
    xhr.open('POST', `${apiUrl}/files/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.send(formData);
  });
}

export function getFileDownloadUrl(attachment: AttachmentInfo) {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
  if (/^https?:\/\//i.test(attachment.url)) {
    return attachment.url;
  }

  return `${apiUrl}${attachment.url}`;
}

export function canPreviewInBrowser(mimeType: string) {
  return mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType === 'text/plain' ||
    mimeType === 'text/csv';
}

export function getFileExtension(filename: string) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toUpperCase() : '';
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
