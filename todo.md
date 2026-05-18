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
