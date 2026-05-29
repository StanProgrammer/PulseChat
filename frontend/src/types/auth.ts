export type AuthMode = 'login' | 'register';
export type Role = 'USER' | 'ADMIN';

export type User = {
  id: string;
  name: string;
  email: string;
  workspaceName: string;
  avatar?: string | null;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

export type AuthResponse = {
  accessToken: string;
  user: User;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type RegisterPayload = LoginPayload & {
  name: string;
  confirmPassword: string;
  workspaceName: string;
};

export type MessageResponse = {
  message: string;
};
