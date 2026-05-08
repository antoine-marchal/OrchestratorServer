# Orchestrator — Web Panel

Central server and web UI for the Orchestrator automation platform. Provides a visual flow editor, execution history, scheduling, remote worker management, and an admin panel for users and secrets.

## Architecture

```
orchestrator-webpanel/
├── server/          # Express.js + TypeScript backend
│   └── src/
│       ├── server.ts                    # Entry point, route registration, startup
│       ├── middleware/
│       │   ├── auth.ts                  # Session token + API key authentication
│       │   └── rbac.ts                  # Role-based access control
│       ├── routes/                      # REST API endpoints
│       │   ├── flows.ts                 # Flow CRUD
│       │   ├── executions.ts            # Execution history + SSE log stream
│       │   ├── jobs.ts                  # In-process job queue
│       │   ├── workers.ts               # Worker registration, heartbeat, job dispatch
│       │   ├── schedules.ts             # Cron / event / API-trigger schedules
│       │   ├── triggers.ts              # Webhook trigger endpoints
│       │   ├── secrets.ts               # AES-256-GCM encrypted secrets
│       │   └── users.ts                 # User management + API key issuance
│       └── services/
│           ├── db/                      # NeDB wrappers + model helpers
│           ├── executor/
│           │   ├── nodeExecutor.ts      # Per-language node runners (JS, Python, Groovy, …)
│           │   └── flowExecutor.ts      # DAG traversal, retry logic, worker dispatch
│           ├── scheduler/
│           │   ├── cronScheduler.ts     # node-cron based schedule runner
│           │   └── eventBus.ts          # File-inbox watcher for event-based triggers
│           └── crypto/aes.ts            # AES-256-GCM encrypt / decrypt
└── client/          # React + Vite frontend
    └── src/
        ├── App.tsx                      # Router, auth guard
        ├── components/
        │   ├── flows/                   # Flows list, execution list, flow detail
        │   ├── admin/                   # AdminLayout, UsersPanel, SecretsPanel
        │   ├── schedule/                # SchedulePanel (cron / event / API trigger)
        │   ├── editor/                  # Full-screen flow editor layout
        │   └── node/                    # Custom React Flow node components
        ├── store/                       # Zustand stores + executors
        └── utils/                       # apiClient, ANSI renderer, snippets, …
```

## Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js ≥ 18, TypeScript |
| HTTP server | Express 4 |
| Database | NeDB (embedded, file-backed) |
| Auth | bcryptjs passwords · JWT-less session tokens · hashed API keys |
| Encryption | AES-256-GCM (secrets at rest) |
| Scheduling | node-cron + custom event bus |
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS + custom `tc-*` design tokens |
| Editor | Monaco Editor (VS Code engine) |
| Flow graph | React Flow |
| State | Zustand |

## Quick Start

### Development

```bash
# Terminal 1 — backend (hot-reload via ts-node)
npm run dev:server

# Terminal 2 — frontend (HMR via Vite)
npm run dev:client
```

Frontend dev server proxies `/api/*` to `http://localhost:3939`.

### Production

```bash
npm run build          # compiles server TS + bundles client
npm start              # serves everything on PORT (default 3939)
```

The server statically serves the built client and falls back to `index.html` for SPA routing.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3939` | HTTP port |
| `ADMIN_PASSWORD` | `admin` | Password for the auto-seeded admin account |
| `ORCHESTRATOR_WORK_DIR` | `process.cwd()` | Working directory for local node execution and inbox |
| `WORKER_REGISTRATION_SECRET` | *(hardcoded dev value)* | Shared secret workers must send on registration |
| `SECRET_ENCRYPTION_KEY` | *(auto-generated)* | AES key for secrets at rest (set explicitly in production) |

> **First-login note:** A default admin user `admin@orchestrator.local` is created on first startup with the password from `ADMIN_PASSWORD`. Change it immediately.

## API Overview

All routes are prefixed `/api/v1`. Protected routes require either a session token (`X-Session-Token` header) or an API key (`Authorization: Bearer <key>`).

| Route | Auth | Description |
|---|---|---|
| `GET /ping` | public | Health check |
| `POST /users/login` | public | Obtain session token |
| `GET /flows` | required | List flows |
| `POST /flows` | required | Create flow |
| `GET /executions` | required | List executions |
| `GET /executions/:id/logs` | required | SSE stream of live / historical logs |
| `POST /executions/:id/stop` | required | Kill a running execution |
| `GET /workers` | required | List registered workers |
| `POST /workers/register` | open | Worker self-registration |
| `POST /workers/:id/heartbeat` | open | Worker keepalive |
| `GET /workers/:id/jobs` | open | Worker job poll |
| `POST /schedules/cron` | required | Create cron schedule |
| `POST /schedules/event` | required | Create event-based schedule |
| `POST /schedules/api-trigger` | required | Create API trigger (returns URL) |
| `GET /secrets` | required | List secrets (names only) |
| `POST /secrets` | required | Create encrypted secret |
| `GET /secrets/:id/reveal` | admin | Decrypt and return a secret value |
| `GET /users` | admin | List users |
| `POST /users/:id/apikeys` | admin | Issue an API key |

## Features

**Flow Editor** — drag-and-drop node graph with Monaco-powered code editor. Supports JavaScript (inline), JS Backend, Python, Groovy, PowerShell, Batch, Playwright, and sub-flow nodes. Goto/condition nodes enable branching.

**Execution Engine** — DAG-based flow runner with per-node retry, timeout, and stop-on-error. JavaScript nodes run inline; all other types spawn isolated child processes. Remote execution is delegated to an assigned worker agent.

**Scheduling** — Cron expressions, file-drop events (inbox watcher), and HTTP API triggers. All schedule types can be enabled/disabled without deletion.

**Workers** — Remote agents self-register over HTTP. The orchestrator polls their status and dispatches script-type nodes to the assigned worker for a given flow.

**Secrets** — AES-256-GCM encrypted values stored in NeDB. Referenced in node code as `${{ secrets.NAME }}`. Resolved server-side immediately before execution.

**RBAC** — Three roles: `admin` (full access), `operator` (run flows, manage schedules), `viewer` (read-only).

## Data Files

NeDB stores data as append-only JSON files in `server/data/`:

```
flows.db          executions.db     schedules.db
workers.db        worker_jobs.db    users.db
secrets.db        sessions.db       roles.db
trigger_tokens.db
```

Back these up before upgrades. They are plain-text and human-readable.
