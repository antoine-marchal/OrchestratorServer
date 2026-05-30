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

Full read of `documentation/`, `todo.md`, and the server + worker source. Severity: 🔴 bug (wrong/broken behavior) · 🟠 security · 🟡 improvement. **17 of 18 fixed this pass (2026-05-30); #62 deferred pending an RBAC product decision.**

### Bugs — broken / incorrect behavior

| # | Sev | Status | Item | What was done |
|---|-----|--------|------|------|
| 49 | 🔴 | ✅ | `flow.completed` / `flow.failed` events were never emitted | `server.ts` subscribed but nothing emitted, so event schedules on flow finish never fired. Now `executeOrchestratorFlow`'s completion monitor emits `flow.completed` (SUCCESS) / `flow.failed` (else) with `{ flowId, executionId, status, flowName }`. |
| 50 | 🔴 | ✅ | `PUT /flows/:id/schedule` didn't schedule anything at runtime | Only wrote `flow.schedule`; cron service reads the `schedules` collection (mirrored only at startup). PUT/DELETE now upsert/remove a `schedules` cron row and call `registerCron`/`unregisterCron` immediately. |
| 51 | 🔴 | ✅ | Cron `timezone` was dropped | `register` called `cron.schedule(expr, fn)` with no options. Added `timezone` to the `Schedule` model, persist it on create/PATCH (`schedules.ts`) and via the flows endpoint, and pass `{ timezone }` into `cron.schedule`. |
| 52 | 🔴 | ✅ | API-key auth polluted the `workers` collection | Removed the dead per-request `workers` upsert (field `lastSeen` ≠ `lastSeenAt`) in `auth.ts` that created nameless permanently-"offline" phantom records. |
| 53 | 🔴 | ✅ | `jobs` in-memory Map grew unbounded (leak) | `finalizeJob` now schedules `jobs.delete(id)` after a 60s grace window (mirrors the `jobLogBuffers` cleanup), so terminal jobs are freed while self-heal still works. |
| 54 | 🔴 | ✅ | `/api/v1/ping` returned hardcoded `2.2.0` | Version now resolved once at boot from `.version` (with package.json fallback across dev + pkg layouts) and served by `/ping`. |
| 55 | 🔴 | ✅ | Worker parallel mode: artifact cleanup raced sibling jobs | Added `maybeCleanupArtifacts` — skips cleanup while `runningJobs > 1`, so only the last job out of a shared `EXECUTION_DIR` deletes. |
| 56 | 🔴 | ✅ | Missing secrets substituted with literal `undefined` regardless of language | Added `missingSecretFill(nodeType)` (server) + JS-type set (worker): JS/jsbackend → `undefined`, all other languages → empty string. Node type threaded through `resolveSecretsDetailed`/`resolveSecrets` at all call sites. |
| 57 | 🔴 | ✅ | `GET /executions?since=<bad>` threw 500 | Now validates the parsed date and returns `BAD_REQUEST` on an invalid `since`. |

### Security

| # | Sev | Status | Item | What was done |
|---|-----|--------|------|------|
| 58 | 🟠 | ✅ | Production CORS allow-list prefix-match bypass | Replaced `o.startsWith(allowed)` with exact equality (`o === allowed`) — `https://app.example.com.evil.com` no longer matches `https://app.example.com`. |
| 59 | 🟠 | ✅ | `POST /flows/:id/execute` had no role check | Now requires `admin`/`operator`; viewers (read-only) get 403. |
| 60 | 🟠 | ✅ | `/auth/refresh` didn't re-check the user | Now re-loads the user by `_id`, rejects if deleted, and re-reads the current role into the new access token (no stale privileges for the 7-day window). |
| 61 | 🟠 | ✅ | No guard against removing the last admin | `DELETE /users/:id` now refuses to delete an admin when they're the last remaining admin (covers self-lockout). |
| 62 | 🟡 | ⬜ | `GET /secrets` / `GET /executions` / `GET /flows` readable by any authenticated role | **Deferred — needs a product decision.** Secret metadata + all flows (full node code/artifacts) are returned to viewers with no owner scoping. If that's not intended, scope flows/executions by owner for non-admins and gate secret listing to operator+. |

### Improvements

| # | Sev | Status | Item | What was done |
|---|-----|--------|------|------|
| 63 | 🟡 | ✅ | Inconsistent worker online thresholds | Centralized in `workers.ts` (`ONLINE_THRESHOLD_MS` + exported `isWorkerOnline`, env `WORKER_ONLINE_THRESHOLD_MS`); `flowExecutor` imports it instead of its own inline 30s. |
| 64 | 🟡 | ✅ | SSE endpoints sent no keep-alive | `/executions/:id/stream` and `/jobs/:jobId/logs` now write a `: ping` comment every 20s, cleared on `req.close`. |
| 65 | 🟡 | ✅ | Background `setInterval`s never cleared on shutdown | Token expirer + reaper handles tracked and `clearInterval`'d in the shutdown handler, which also calls `eventBus.stopWatcher()`. |
| 66 | 🟡 | ✅ | `eventBus.watchInbox` no debounce / null guard | Added a 250ms per-filename debounce + null-filename guard (still leaves the persistent idempotency ledger to backlog #18). |
| 67 | 🟡 | ✅ | Single-use trigger token check-then-set not atomic | Now a conditional `update({_id, used:false}, {$set:{used:true}})`; only the request that claims the token (non-zero modified count) fires the flow. |
| 68 | 🟡 | ✅ | No shared version source | Same boot-time version resolver as #54, reused for `/ping`. |

> Verified: `tsc --noEmit` clean on server + worker; `npm test` (server) 32/32 pass. **Backend must be restarted to pick up these `src` changes** (dev ts-node hot-reloads; a packaged binary needs a rebuild).

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
