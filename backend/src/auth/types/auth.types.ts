import { Role } from '@prisma/client';

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
};

export type AuthenticatedUser = JwtPayload;

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
};
