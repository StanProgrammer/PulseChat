# PulseChat

A mini Slack-inspired chat application built with a React frontend and a NestJS backend. The project now includes a working authentication flow with JWT access tokens, HTTP-only refresh cookies, Prisma/PostgreSQL persistence, and a polished auth-first frontend.

## Current Status

- Frontend auth landing page connected to backend login and registration APIs
- Smooth login/register switching with polished loading, validation, success, and error states
- Responsive split-screen layout inspired by modern productivity and team chat tools
- Tailwind CSS 4 configured through the Vite plugin
- NestJS authentication module with DTO validation and structured error handling
- Secure password hashing with bcrypt
- JWT access tokens plus refresh tokens stored in HTTP-only cookies
- Role support with `USER` and `ADMIN` roles
- Protected route handling through JWT and role guards
- Prisma 7 PostgreSQL setup with a `User` model and future-ready message relation

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: NestJS, TypeScript, Prisma, Socket.IO
- Database: PostgreSQL
- Tooling: npm workspaces, Docker Compose

## Project Structure

```text
chat app/
  frontend/      React + Vite frontend
  backend/       NestJS backend API and Socket.IO server
  docker-compose.yml
  package.json   Workspace scripts
```

## Getting Started

Install dependencies from the project root:

```bash
npm install
```

Start PostgreSQL with Docker:

```bash
docker compose up postgres
```

Push the Prisma schema to the database:

```bash
npm --workspace backend run prisma:push
```

Start the frontend and backend together:

```bash
npm run dev
```

Run only the frontend:

```bash
npm run dev:frontend
```

Run only the backend:

```bash
npm run dev:backend
```

The frontend Vite server is configured on port `4173`.
The backend API server is configured on port `4000`.

## Authentication API

Base URL:

```text
http://localhost:4000
```

Endpoints:

```text
POST /auth/register     Create a user and start a session
POST /auth/login        Sign in and start a session
POST /auth/refresh      Rotate refresh token and issue a new access token
POST /auth/logout       Clear the refresh token and end the session
GET  /auth/me           Validate an access token and return the current user
GET  /auth/admin/check  Example admin-only protected route
```

Login and register return an `accessToken` in the JSON response and set a `refresh_token` HTTP-only cookie. The frontend stores the access token in `sessionStorage` and relies on the HTTP-only cookie for session refresh.

## Available Scripts

From the root workspace:

```bash
npm run bootstrap       # Install workspace dependencies
npm run dev             # Start backend and frontend together
npm run dev:frontend    # Start Vite frontend
npm run dev:backend     # Start NestJS backend in dev mode
npm run build           # Build backend and frontend
npm run lint            # Run configured lint scripts
```

From `frontend/`:

```bash
npm run dev
npm run build
npm run preview
```

From `backend/`:

```bash
npm run start:dev
npm run build
npm run start
npm run prisma:generate
npm run prisma:push
```

## Docker

Run the development stack with:

```bash
docker compose up --build
```

## Environment Files

Use the example files as a starting point for local configuration:

- `frontend/.env.example`
- `backend/.env.example`
- `.env.example`
- `docker-compose.yml`

Local `.env` files are included for development and are ignored by git. Replace all JWT secrets before production deployment.

## Next Steps

- Add production-grade password reset and email verification
- Add route handling for authenticated chat pages
- Build workspace, channel, and direct message screens
- Add Socket.IO real-time messaging
- Persist workspaces, channels, memberships, and messages with Prisma/PostgreSQL
