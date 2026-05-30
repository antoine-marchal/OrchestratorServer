# Orchestrator — Improvement Backlog

Status legend: ✅ done · 🚧 in progress · ⬜ pending · ❌ won't do

Cost: 1 = an hour · 5 = multi-week.

---

## Security

| # | Item | Cost | Status |
|---|------|------|--------|
| 1 | JWT secret refuse-start in production with default value (`server.ts`) | 1 | ✅ |
| 2 | Per-secret random salt in `aes.ts` (kill hardcoded `'orchestrator-salt'`) | 2 | ⬜ |
| 3 | Master-key fallback hard-fail in production (`aes.ts:38`) | 1 | ✅ (covered by #1 guard) |
| 4 | Separate `REFRESH_SECRET` env var (don't derive from `JWT_SECRET`) | 1 | ⬜ |
| 5 | Per-worker bearer token issued at register; required on all worker endpoints | 3 | ✅ |
| 6 | Rate-limit `/auth/login` + `/authProxy` (`express-rate-limit`) | 1 | ⬜ |
| 7 | Sanitize artifact `name` against path traversal (server + worker) | 1 | ✅ |
| 8 | Lower default `express.json` body limit (50mb → 5mb) | 1 | ⬜ |
| 9 | Pin CORS origins to `DOMAIN` + `ORCHESTRATOR_CORS_ORIGINS` in production | 1 | ✅ |
| 10 | API key auth: indexed `apiKeys.keyHash` query (no full user scan) | 2 | ✅ |
| 11 | Hash API keys with scrypt/argon2 + per-key salt (not bare SHA-256) | 2 | ⬜ |
| 12 | Replace `?token=` query JWT with short-lived ticket exchange | 3 | ⬜ |
| 13 | Sandbox the inline JS node executor (`isolated-vm` or move to worker) | 3 | ⬜ |
| 14 | CSRF protection (only if cookie auth lands) | 2 | ⬜ |
| 15 | Move refresh token from `localStorage` to httpOnly cookie + rotation | 3 | ⬜ |

## Reliability

| # | Item | Cost | Status |
|---|------|------|--------|
| 16 | Configurable per-flow/per-node worker dispatch timeout (replace hardcoded 5min) | 2 | ⬜ |
| 17 | Worker reaper: offline worker → cancel its in-flight worker_jobs + notify executor | 2 | ✅ |
| 18 | `eventBus.watchInbox` idempotency ledger (no re-fire after restart) | 1 | ⬜ |
| 19 | Document NeDB as dev-only; default to Mongo in production | 3 | ⬜ |
| 20 | `startPoll` exponential backoff + give-up window on network errors | 1 | ⬜ |
| 21 | `pendingWorkerJobs` race: idempotent completion path | 1 | ✅ |
| 22 | Execution retention policy (delete completed > N days) | 1 | ⬜ |

## Scalability

| # | Item | Cost | Status |
|---|------|------|--------|
| 23 | DB-level pagination for `/api/v1/executions` (sort/skip/limit + indexes) | 2 | ✅ |
| 24 | Replace polling fan-out with single SSE channel per page | 4 | ⬜ |
| 25 | Worker long-poll (server holds /jobs, dispatch wakes listener) | 3 | ✅ |

## Code quality

| # | Item | Cost | Status |
|---|------|------|--------|
| 26 | Split `nodeExecutor.ts` per language (groovy/python/ps/…) + shared `runProcess` | 3 | ⬜ |
| 27 | Split `FlowDetail.tsx` (1069 LOC) per tab | 3 | ⬜ |
| 28 | Split `flowExecutor.executeRegularNode` (secrets / local-js / transient) | 2 | ⬜ |
| 29 | Drop `(req as any).user` casts — use the global declare | 1 | ⬜ |
| 30 | Centralize `WORK_DIR` resolution in `services/config.ts` | 1 | ⬜ |
| 31 | Normalize error response shape across routes | 1 | ⬜ |
| 32 | Remove `setExecuteFlowFn` global injection — use proper DI | 2 | ⬜ |

## Observability

| # | Item | Cost | Status |
|---|------|------|--------|
| 33 | Structured logging (`pino`) with levels | 1 | ⬜ |
| 34 | `/metrics` Prometheus endpoint (`prom-client`) | 2 | ⬜ |
| 35 | Append-only audit log for admin actions | 1 | ⬜ |

## Testing / DevOps

| # | Item | Cost | Status |
|---|------|------|--------|
| 36 | Vitest test infra + tests: crypto / secrets / artifactPath / flow parser | 4 | ✅ |
| 37 | Bump `pkg` Node target 18 → 20/22 | 1 | ⬜ |
| 38 | Multi-stage Dockerfile + compose with Mongo | 1 | ⬜ |
| 39 | GitHub Actions CI (lint/typecheck/test on PR) | 1 | ⬜ |

## UX / Frontend

| # | Item | Cost | Status |
|---|------|------|--------|
| 40 | Surface `MAX_EXECUTIONS=500` truncation + "load more" | 1 | ⬜ |
| 41 | Optimistic UI on kill execution | 1 | ⬜ |
| 42 | `useMemo` on FlowsList stats | 1 | ⬜ |
| 43 | `apiClient` 401 → refresh → retry interceptor | 2 | ⬜ |

## Feature gaps

| # | Item | Cost | Status |
|---|------|------|--------|
| 44 | Per-flow concurrency cap | 2 | ⬜ |
| 45 | Worker tags / required-capabilities matching | 2 | ⬜ |
| 46 | Flow versioning + run-snapshot diff UI | 3 | ⬜ |
| 47 | `app.set('trust proxy', 1)` for accurate `req.ip` | 1 | ⬜ |
| 48 | Dark/light theme switch | 2 | ⬜ |

---

## Review pass 2026-05-30 — new findings

Full read of `documentation/`, `todo.md`, and the server + worker source. Items below are NOT yet tracked above. Severity: 🔴 bug (wrong/broken behavior) · 🟠 security · 🟡 improvement.

### Bugs — broken / incorrect behavior

| # | Sev | Item | What needs to be done |
|---|-----|------|------|
| 49 | 🔴 | `flow.completed` / `flow.failed` events are never emitted | `server.ts:281-282` subscribes to these events and the docs (ARCHITECTURE §6, API.md) advertise event schedules on flow finish, but **nothing ever calls `eventBus.emit('flow.completed' / 'flow.failed', …)`** — only `file.arrived` is emitted (in `eventBus.watchInbox`). So every `type=event` schedule bound to `flow.completed`/`flow.failed` silently never fires. Emit these in `flowExecutor.executeOrchestratorFlow`'s completion monitor (`flowExecutor.ts:673-722`) with `{ flowId, executionId, status }` after the execution record is finalized. |
| 50 | 🔴 | `PUT /flows/:id/schedule` doesn't actually schedule anything at runtime | The endpoint (`flows.ts:238-250`) only writes `flow.schedule = {cron,enabled,timezone}`. The cron service (`cronScheduler.ts`) reads **only** the `schedules` collection, and the `flow.schedule → schedules` mirror (`migrateLegacyFlowSchedules`) runs **only at startup**. So a cron set via this endpoint never fires until the next server restart. Either (a) make this endpoint create/update a `schedules` row + call `registerCron`, or (b) remove it and point the UI/docs at `POST /schedules/cron`. Decide and converge — right now there are two divergent scheduling paths. |
| 51 | 🔴 | Cron `timezone` is dropped | `flow.schedule` stores a `timezone` (`flows.ts:239`) but `cronScheduler.register` calls `cron.schedule(expr, fn)` with **no options** (`cronScheduler.ts:36`), so node-cron always runs in server-local time. Pass `{ timezone }` through the `schedules` row into `cron.schedule(expr, fn, { timezone })`, and persist `timezone` when creating cron schedules in `schedules.ts:33-50`. |
| 52 | 🔴 | API-key auth pollutes the `workers` collection with phantom records | On every `ApiKey` request `auth.ts:88-106` upserts a doc into the **same `workers` collection** keyed by `apiKeyId`, writing field `lastSeen` (note: not `lastSeenAt`). The UI worker list (`workers.ts:255-263`) and the reaper (`server.ts:310`) both key off `lastSeenAt`, so these records show as permanently "offline", never get reaped, have no `name`, and clutter the Workers panel. Either drop this upsert entirely (it looks like dead legacy "worker = API user" code) or move it to its own collection. Confirm nothing reads these records first. |
| 53 | 🔴 | `jobs` in-memory Map grows unbounded (memory leak) | `nodeExecutor.ts:173` `export const jobs = new Map()` is only ever `.set()`, never `.delete()` (grep-confirmed). Every execution + every transient sub-node job stays resident for the process lifetime; `jobLogBuffers` is freed after 60s but the `jobs` entry it keys off is not. Add a delayed `jobs.delete(jobId)` once a job reaches a terminal state (mirroring the existing `jobLogBuffers` 60s cleanup), keeping a grace window so `GET /executions/:id` self-heal still works. |
| 54 | 🔴 | `/api/v1/ping` returns a hardcoded stale version | `server.ts:113` responds `version: '2.2.0'` while the product is 3.1.2 (README, `.version`). The runbook tells operators to verify the deployed version via `/ping`, so this is actively misleading. Read the version from `.version`/`package.json` at startup and serve that. |
| 55 | 🔴 | Worker parallel mode: artifact cleanup races between sibling jobs | In `WORKER_EXECUTION_MODE=parallel`, two jobs of the same flow share one `EXECUTION_DIR`. `executeJob` (`agent.ts:261-273`) calls `cleanupArtifacts` when **each** job finishes, so the first to complete deletes artifacts the second is still using. Reference-count artifacts per `EXECUTION_DIR` (or per executionId), or only clean up when the worker goes idle (`runningJobs === 0`). |
| 56 | 🔴 | Missing secrets are substituted with literal `undefined` regardless of language | `secrets.ts:130` and `agent.ts:158` replace an unresolved `${{ secrets.X }}` with the bare token `undefined`. That is only valid in JavaScript — in Python it's a `NameError`, in PowerShell/Groovy/Batch it injects a wrong value silently. Substitute an empty string (or fail the node) for non-JS node types, and surface the missing-secret error consistently. |
| 57 | 🔴 | `GET /executions?since=<bad>` throws 500 | `executions.ts:13` does `new Date(req.query.since).toISOString()` with no validation; a non-date `since` throws `RangeError` and returns 500 instead of 400. Validate the parsed date (`isNaN(d.getTime())`) and return `BAD_REQUEST`. |

### Security

| # | Sev | Item | What needs to be done |
|---|-----|------|------|
| 58 | 🟠 | Production CORS allow-list uses a prefix match → bypass | `server.ts:95` accepts an origin if `o.startsWith(allowed)`. With `allowed = https://app.example.com`, the origin `https://app.example.com.evil.com` passes (`startsWith` is true). Use exact equality (`o === allowed`) — drop the `startsWith` branch — or parse and compare host + scheme + port. |
| 59 | 🟠 | `POST /flows/:id/execute` has no role / access check | The execute route (`flows.ts:225-236`) is mounted behind `authMiddleware` only — no `requireRole`/`requireFlowEditAccess`. A **viewer** (read-only) can trigger any flow, including admin-owned ones, with whatever side effects the flow has. Require at least `operator`, and ideally run it through the same `canUserEditFlow`/ownership gate used for PUT/DELETE. |
| 60 | 🟠 | `/auth/refresh` re-issues access tokens without re-checking the user | `users.ts:39-50` mints a new 8h access token straight from the refresh-token payload — it never re-loads the user, so a **deleted or demoted** user keeps their old role for up to 7 days. Load the user by `_id`, reject if missing, and re-read `role` from the DB rather than trusting the token. |
| 61 | 🟠 | No guard against removing the last admin / self-lockout | `DELETE /users/:id` (`users.ts:104`) lets an admin delete the only admin (or themselves), permanently locking out admin access. Before delete, if the target is an admin, refuse when it's the last remaining admin. |
| 62 | 🟡 | `GET /secrets` and `GET /executions` / `GET /flows` are readable by any authenticated role | Secret names/metadata and all flows (full node code + artifacts) are returned to viewers with no owner scoping. Confirm this matches the intended RBAC model; if not, scope flows/executions by owner for non-admins and gate secret listing to operator+. |

### Improvements

| # | Sev | Item | What needs to be done |
|---|-----|------|------|
| 63 | 🟡 | Inconsistent worker online/offline thresholds | Flow dispatch treats a worker as offline after 30s (`flowExecutor.ts:594`, `workers.ts:11`), but the reaper only cancels jobs after `WORKER_OFFLINE_TIMEOUT_MS`=60s (`server.ts:304`). A worker last seen 45s ago is "offline" for new runs yet still holds in-flight jobs. Centralize the threshold in one config value and derive both from it. |
| 64 | 🟡 | SSE endpoints send no keep-alive heartbeat | `/executions/:id/stream` and `/jobs/:jobId/logs` never write a periodic comment frame, so idle proxies/load balancers may drop long-lived connections (common for flows that idle between log lines). Write a `: ping\n\n` comment every ~15–25s and clear it on `req.close`. |
| 65 | 🟡 | Background `setInterval`s are never cleared on shutdown | The trigger-token expirer + worker reaper (`server.ts:286,305`) and the per-execution monitors keep running during graceful shutdown; only `server.close()` is awaited. Track and `clearInterval` them in the `shutdown` handler (and consider `.unref()`), so shutdown is clean and tests don't leak timers. |
| 66 | 🟡 | `eventBus.watchInbox` has no idempotency / debounce (relates to backlog #18) | `fs.watch` can fire twice for one file and `filename` can be null on some platforms (`eventBus.ts:12-19`). Combine with backlog #18 (idempotency ledger) and add a short debounce + null-filename guard so one dropped file triggers exactly one `file.arrived`. |
| 67 | 🟡 | Single-use trigger token check-then-set is not atomic | `triggers.ts:40-47` reads `used`, then later sets `used=true` — two concurrent requests can both pass the check and double-fire the flow. Make it a conditional update (`update({_id, used:false}, {$set:{used:true}})`) and only execute if it modified a row. |
| 68 | 🟡 | `/ping` aside, no shared version source | `set-version.bat` writes `.version` + every `package.json`, but the server hardcodes `2.2.0`. Import the version once (read `.version` at boot) and reuse it for `/ping`, startup logs, and any UI "about". Removes a whole class of drift. |

---

## Shipped this round (commit-ready)

- #1 production secret guard
- #5 per-worker token (worker side updated, /register returns token, re-register on 401)
- #7 path-traversal-safe artifact extraction (server + worker)
- #9 CORS production allow-list
- #10 indexed API-key auth + DB index hot paths
- #17 worker reaper (30s sweep, cancels stale worker_jobs)
- #21 idempotent worker `/complete` (don't overwrite terminal state)
- #23 DB-level pagination for executions list
- #25 worker long-poll (server holds GET /jobs up to 25s, dispatch wakes it)
- #36 vitest + 22 passing tests (crypto, secret-substitution, artifactPath, flow parser)

Also from the previous review pass:
- HTTPS mode + `scripts/gen-cert.bat`
- SSO `service=` parameter + `DOMAIN` env
- Reconcile stranded executions on boot
- Sweep `running`/`retrying` node statuses on flow finalize
- GET `/executions/:id` self-heals when in-memory job is lost
