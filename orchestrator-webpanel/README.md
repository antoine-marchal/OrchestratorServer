# Orchestrator — Web Panel

Central server and web UI for the Orchestrator automation platform. Provides a visual flow editor, per-flow git versioning (branches, commits, clone/push), content-addressed artifact storage, execution history, scheduling, remote worker management with access policies, and an admin panel for users and secrets.

## Architecture

```
orchestrator-webpanel/
├── server/          # Express.js + TypeScript backend
│   └── src/                            # Layered MVC — deps flow http → domain → data (+ infra)
│       ├── server.ts                    # Composition root: wiring, routes, errorHandler, startup
│       ├── http/                        # Controller layer (transport only)
│       │   ├── routes/                  # REST endpoints: flows, executions, jobs, workers,
│       │   │                            #   schedules, triggers, secrets, users (thin)
│       │   ├── middleware/              # auth (JWT + API key), rbac, errorHandler
│       │   └── validators/              # zod schemas + validateBody middleware
│       ├── domain/                      # Business services (framework-free)
│       │   ├── execution/               # flowExecutor, nodeExecutor, artifactStore, executionLogs
│       │   ├── workers/workerService.ts # Access policy, liveness, node→worker dispatch
│       │   └── secrets/secretService.ts # ${{ secrets.X }} resolution
│       ├── data/                        # Data-access layer
│       │   ├── db/                      # ICollection abstraction (NeDB / MongoDB)
│       │   ├── models/                  # Typed entities
│       │   └── repositories/            # One typed repository per entity (flowRepository, …)
│       └── infra/                       # Adapters
│           ├── git/                     # Per-flow in-DB git repo (materialize, commit, store, smart-HTTP)
│           ├── scheduler/               # cronScheduler + eventBus
│           ├── crypto/aes.ts            # AES-256-GCM encrypt / decrypt
│           └── auth/tokens.ts           # API-key hashing + JWT sign/verify primitives
└── client/          # React + Vite frontend
    └── src/
        ├── App.tsx                      # Router, auth guard
        ├── api/                         # http.ts transport + per-domain clients (flowsApi, …)
        ├── components/
        │   ├── flows/                   # Flows list, execution list, flow detail
        │   ├── admin/                   # AdminLayout, UsersPanel, SecretsPanel, RawKeyModal, RoleBadge
        │   ├── schedule/                # SchedulePanel (cron / event / API trigger)
        │   ├── editor/                  # Full-screen flow editor layout
        │   └── node/                    # Custom React Flow node components
        ├── store/                       # Zustand stores + executors
        └── utils/                       # apiClient shim (→ api/), ANSI renderer, snippets, …
```

## Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js ≥ 18, TypeScript (strict) |
| HTTP server | Express 4 |
| Database | NeDB (embedded, file-backed) **or** MongoDB — auto-selected by `MONGO_URI` |
| Auth | bcryptjs passwords · JWT session + refresh tokens · hashed API keys · optional CAS/SSO proxy-auth |
| Versioning | In-DB git repo per flow (objects/refs in the database, smart-HTTP) |
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
# Terminal 1 — backend (tsx)
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

Key variables (full reference with defaults: [`release/server.env.example`](../release/server.env.example)):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3939` | HTTP port |
| `NODE_ENV` | `development` | `production` enforces the secrets guard + CORS allow-list |
| `MONGO_URI` | *(unset)* | Set → MongoDB; unset → embedded NeDB under `<WORK_DIR>/data` |
| `ADMIN_PASSWORD` | `admin` | Password for the auto-seeded admin account (first boot only) |
| `JWT_SECRET` | *(placeholder)* | Signs JWT session + refresh tokens (set a long random value in prod) |
| `ORCHESTRATOR_MASTER_KEY` | *(placeholder)* | AES key for secrets at rest — **never rotate after secrets exist** |
| `WORKER_REGISTRATION_SECRET` | *(placeholder)* | Shared secret workers must send on registration |
| `ORCHESTRATOR_WORK_DIR` | `process.cwd()` | Working directory for local node execution, inbox, NeDB `data/` |

> **Production guard:** with `NODE_ENV=production` the server refuses to start while `JWT_SECRET`, `ORCHESTRATOR_MASTER_KEY`, `WORKER_REGISTRATION_SECRET`, or `ADMIN_PASSWORD` are left at their placeholder/default values.

> **First-login note:** the `admin` user is created on first startup with the password from `ADMIN_PASSWORD`. Change it immediately.

## API Overview

All routes are prefixed `/api/v1`. Protected routes require either a JWT (`Authorization: Bearer <jwt>`) or an API key (`Authorization: ApiKey <key>`). Endpoints that can't set headers (SSE, downloads) also accept `?token=<jwt>`.

Full reference: [`documentation/API.md`](../documentation/API.md). A few entry points:

| Route | Auth | Description |
|---|---|---|
| `GET /ping` | public | Health check |
| `POST /auth/login` | public | Obtain `{ accessToken, refreshToken, user }` |
| `GET /flows` | required | List flows |
| `POST /flows/:id/execute` | admin/operator | Run a flow (optional `{ workerId, branch }` variant overrides) |
| `GET /flows/:id/branches` | required | List git branches |
| `POST /flows/:id/artifacts` | edit | Upload a raw-binary artifact (content-addressed) |
| `GET /executions/:id/stream` | required | SSE stream of live / historical logs |
| `GET /workers` | required | List registered workers |
| `PATCH /workers/groups/:group/access` | admin | Set a worker group's access policy |
| `POST /secrets` | admin/operator | Create encrypted secret |
| `POST /users/:id/apikeys` | admin | Issue an API key |

Git smart-HTTP lives outside `/api/v1`, under `/git/:flowId` (HTTP Basic: login + API key) — `git clone`/`pull`/`push` a flow.

## Features

**Flow Editor** — drag-and-drop node graph with Monaco-powered code editor. Supports JavaScript (inline), JS Backend, Python, Groovy, PowerShell, Batch, Shell, and sub-flow nodes (Playwright browser automation runs inside JS nodes — it is not a separate node type). Goto/condition nodes enable branching.

**Git versioning** — every flow is an in-DB git repo. Editor saves become commits (amend-or-new-commit heuristic), you work on **branches**, and you can `git clone`/`pull`/`push` a flow over smart-HTTP. Flow versions (snapshots) coexist with the git history.

**Variants** — run/schedule the same flow as independent "subrows", each with a different worker and/or branch override.

**Execution Engine** — DAG-based flow runner with per-node retry, timeout, and stop-on-error. JavaScript nodes run inline; all other types spawn isolated child processes. Remote execution is delegated to an assigned worker agent.

**Artifacts** — files attached to a flow, stored once by `sha256` (content-addressed), chunked above 8 MB, dropped to disk before a run, auto-unpacked if an archive. Reclaimed by a janitor when unreferenced.

**Scheduling** — Cron expressions, file-drop events (inbox watcher), and HTTP API triggers. All schedule types can be enabled/disabled without deletion, and can target a flow variant.

**Workers** — Remote agents self-register over HTTP. The orchestrator polls their status and dispatches script-type nodes to the assigned worker. Per-group **access policies** (allow/deny by role/user) gate who can run on a worker.

**Secrets** — AES-256-GCM encrypted values. Referenced in node code as `${{ secrets.NAME }}`. Resolved server-side immediately before execution.

**RBAC** — Three roles: `admin` (full access), `operator` (run flows, manage schedules), `viewer` (read-only).

## Data Files

In NeDB mode, data is stored as append-only JSON files in `<WORK_DIR>/data/`:

```
flows.db          executions.db     schedules.db
workers.db        worker_jobs.db    users.db
secrets.db        sessions.db       roles.db
trigger_tokens.db flow_versions.db
git_objects.db    git_refs.db                       # per-flow git repos
artifact_blobs.db artifact_chunks.db                # content-addressed artifacts
```

Back these up before upgrades. They are plain-text and human-readable. In MongoDB mode (`MONGO_URI` set) the same collections live in Mongo instead, with object/artifact bytes stored as `BinData`.
