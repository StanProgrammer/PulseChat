import { AuthResponse, LoginPayload, RegisterPayload, User } from '../types/auth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const ACCESS_TOKEN_KEY = 'pulsechat_access_token';

function getApiMessage(errorBody: unknown, fallback: string) {
  if (!errorBody || typeof errorBody !== 'object') {
    return fallback;
  }

  const message = (errorBody as { message?: string | string[] }).message;

  if (Array.isArray(message)) {
    return message.join(' ');
  }

  return message || fallback;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const { headers, ...requestOptions } = options;

  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...requestOptions,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });

  const data = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getApiMessage(data, 'Something went wrong. Please try again.'));
  }

  return data as T;
}

export function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`
  };
}

export function getStoredAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';
}

export function storeAccessToken(accessToken: string) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
}

export function clearStoredAccessToken() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function login(payload: LoginPayload) {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function register(payload: RegisterPayload) {
  return apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function refreshSession() {
  return apiRequest<AuthResponse>('/auth/refresh', { method: 'POST' });
}

export function getProfile(accessToken: string) {
  return apiRequest<{ user: User }>('/auth/me', {
    headers: authHeaders(accessToken)
  });
}

export function logout(accessToken: string) {
  return apiRequest('/auth/logout', {
    method: 'POST',
    headers: authHeaders(accessToken)
  });
}
