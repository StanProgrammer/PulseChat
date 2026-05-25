# PulseChat

A mini Slack-inspired chat application built with a React frontend and a NestJS backend. The project is currently focused on the initial authentication landing experience and the app scaffold for future real-time chat features.

## Current Status

- Frontend auth landing page for login and registration
- Smooth login/register switching with polished loading, hover, and focus states
- Responsive split-screen layout inspired by modern productivity and team chat tools
- Tailwind CSS 4 configured through the Vite plugin
- Backend scaffold using NestJS, Prisma, PostgreSQL, and Socket.IO
- No authentication or chat backend integration yet

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

## Next Steps

- Connect the login and registration forms to backend authentication
- Add route handling for authenticated and guest pages
- Build workspace, channel, and direct message screens
- Add Socket.IO real-time messaging
- Persist users, workspaces, channels, and messages with Prisma/PostgreSQL
