# Target Architecture — `orchestrator-worker` & `orchestrator-webpanel`

Goal: a clean, layered, MVC-style architecture with strict dependency direction.
Each layer may only call the layer beneath it. Nothing reaches back up.

> ## Status — implemented ✅ (2026-06-12)
> This plan is now realized. See `documentation/ARCHITECTURE.md` for the authoritative current structure.
> - **Server** — layered into `http / domain / data / infra` + repository layer (`data/repositories/*`); thin controllers; `getCollection` confined to `BaseRepository` + storage adapters. Plus a validation layer (`http/validators/` zod schemas + `validateBody`) and central `errorHandler`. Build green, 44 tests pass.
> - **Worker** — split into `agent.ts` (entry) + `config / transport / lifecycle / poller / jobs / runtimes`; `runtimes/` is one file per language behind a `Runtime` interface with a registry dispatcher. Build green.
> - **Client** — `api/` layer: HTTP transport (`api/http.ts`) + per-domain clients; all ~70 raw-URL call sites migrated. Baseline typecheck fixed (was 36 errors → 0); `vite build` green.
> - **Shared execution-core** — done separately (by the maintainer).
> - **Cross-cutting** — shared `tsconfig.base.json` for the Node backends; deduplicated packaging scripts into `scripts/lib/`; oversized `AdminLayout` partially split (helpers extracted). Deep splits of `FlowDetail`/`FlowEditor` remain (regression risk without a client test suite — do incrementally with manual QA).

```
HTTP / View   →   Service (domain)   →   Repository (data)   →   DB
                          ↓
                    Infra adapters (git, crypto, scheduler, runtimes)
```

The rule that makes everything else fall into place: **the layer above never knows the
implementation of the layer two levels below.** A route never calls `getCollection`. A React
component never calls `axios`. A service never imports `express`.

---

## 1. Server (`orchestrator-webpanel/server`) — layered MVC

### Current pain
- `routes/flows.ts` (577 LOC) calls `getCollection('flows')` **23 times** and runs git
  materialization + commit logic inline. The same fat-controller pattern is in
  `workers.ts` (460), `executions.ts` (279), `users.ts` (262).
- `services/` mixes **domain** (`executor`, `scheduler`) with **infrastructure**
  (`git`, `crypto`, `db`). No seam between "what the app does" and "how it stores/talks."
- No repository layer — query shapes are copy-pasted across routes.

### Target layout
```
server/src/
  http/                         # ── Controller layer (transport only) ──
    routes/                     #   thin: validate → call service → send response
      flows.routes.ts
      executions.routes.ts
      workers.routes.ts
      ...
    middleware/                 #   auth, rbac, errorHandler, requestLogger
    validators/                 #   one schema per endpoint (zod), input parsing
  domain/                       # ── Service / Model layer (framework-free) ──
    flows/        FlowService.ts
    executions/   ExecutionService.ts
    workers/      WorkerService.ts
    scheduling/   ScheduleService.ts
    secrets/      SecretService.ts
    users/        UserService.ts
  data/                         # ── Repository layer ──
    repositories/
      FlowRepository.ts         #   wraps getCollection('flows'), returns Flow entities
      ExecutionRepository.ts
      WorkerRepository.ts
      UserRepository.ts
      ...
    db/                         #   ICollection, MongoCollection, NeDBCollection (unchanged)
    models/                     #   entities + invariants (move existing db/models here)
  infra/                        # ── Adapters (side-effecting, swappable) ──
    git/                        #   flowCommit, flowMaterialize, FlowGitRepository, receivePack
    crypto/                     #   aes
    scheduler/                  #   cronScheduler, eventBus
  execution/                    # ── shared execution core (see §4) ──
  config.ts
  server.ts                     # ── composition root: wires everything together ──
```

### Dependency rules
- `http/routes` → `domain/*Service` only. **No `getCollection`, no git imports in routes.**
- `domain/*Service` → `data/repositories` + `infra/*`. No `express`, no `req`/`res`.
- `data/repositories` → `data/db`. Returns typed entities, not raw docs.
- `infra/*` → external libs only.

### What each route shrinks to
```ts
// http/routes/flows.routes.ts
router.post('/:id/execute', requireFlowAccess, validate(executeSchema), async (req, res) => {
  const result = await flowService.execute(req.params.id, req.body, req.user);
  res.json(result);
});
```
All the `getCollection` / commit / materialize logic moves into `FlowService` and the repos.

---

## 2. Worker (`orchestrator-worker`) — split the two god files

### Current pain
`agent.ts` (445) mixes lifecycle (register, heartbeat), the long-poll loop, token handling, and
GROOVY_JAR extraction. `executor/nodeExecutor.ts` (552) is all 7 language runners in one file.
The runners are a **duplicate** of the server's executor (the documented "Server/Worker Executor
Sync Pitfall").

### Target layout
```
worker/src/
  agent/
    lifecycle.ts       # register(), heartbeat(), setWorkerToken()
    poller.ts          # long-poll loop, claim-or-skip
  jobs/
    jobRunner.ts       # claim → execute → report status/logs back
  runtimes/            # ── one file per language, single interface ──
    Runtime.ts         #   interface Runtime { run(opts): Promise<NodeResult> }
    processRuntime.ts
    pythonRuntime.ts
    groovyRuntime.ts
    powershellRuntime.ts
    batchRuntime.ts
    shellRuntime.ts
    jsRuntime.ts
    index.ts           #   registry: type → Runtime
  execution/           # ── shared core, imported from §4 ──
  transport/
    httpClient.ts      # axios + token attach
  config.ts            # env parsing (POLL_INTERVAL_MS, sizes, GROOVY_JAR)
  main.ts              # entrypoint: wire lifecycle + poller + jobRunner
```

`executeNode()` becomes a 10-line dispatcher: pick `runtimes[node.type]`, call `.run()`.

---

## 3. Client (`orchestrator-webpanel/client`) — MVVM (MVC's React cousin)

Already the best-structured of the three. Tighten the boundaries.

### Current pain
- `store/executors/{nodeExecutor.ts 555, flowExecutor.ts 370}` **re-implement server execution
  rules** on the client — a third copy of execution logic.
- `utils/apiClient.ts` is a 45-method god object bridging 14 UI areas.
- A few oversized views (`FlowDetail.tsx` 1521, `FlowEditor.tsx` 858).

### Target layout
```
client/src/
  views/                # ── View ── (rename of components/, keep subfolders)
    flows/ editor/ execution/ admin/ node/ schedule/
  viewmodels/           # ── ViewModel ── (rename of store/, slice per domain)
    sessionStore.ts flowLibraryStore.ts ...
    actions/ operations/    # keep
  api/                  # ── Model / data access ──
    client.ts           #   thin axios+auth core (getJwt/setJwt)
    flowsApi.ts executionsApi.ts workersApi.ts authApi.ts
    secretsApi.ts usersApi.ts scheduleApi.ts   # split from the 45-method ApiClient
  shared/               # hooks, context, constants, types, utils
```

### Key rule
The client **does not run flows**. Delete the `store/executors/*` duplication; subscribe to the
server's existing **SSE live log stream** for status/logs. The client computes *display* state
(timeline, graph colors) only — never execution semantics.

---

## 4. Shared execution core (the keystone)

Both server and worker re-implement node/flow execution. Extract the runtime-neutral logic into one
place both import:

```
shared/execution-core/          # internal package or path alias
  state.ts        # NodeStatus state machine, transitions
  scope.ts        # scopeKey, childScope, timing (already cohesive: "Execution Timing & Scope")
  logs.ts         # encode/decode, log collector
  artifacts.ts    # extract/cleanup, safeArtifactPath traversal guard
  errors.ts       # detectLogErrorTrigger, computeProcessError
  types.ts        # NodeResult, RunOpts, ExecuteOverrides
```

Server `domain/executions` and worker `jobs/jobRunner` both consume this. **One source of truth**
for execution rules → the "sync pitfall" disappears.

---

## Migration plan (incremental, ship-as-you-go — no big-bang rewrite)

Each step is independently shippable and leaves the app green.

1. **Repository layer for flows** (low risk, high signal). Create `FlowRepository`, move the 23
   `getCollection('flows')` calls out of `flows.routes.ts`. Proves the pattern on the worst file.
2. **`FlowService`** — pull business logic out of `flows.ts` routes into the service. Routes become
   thin. Repeat for executions, workers, users.
3. **Reorg server folders** into `http / domain / data / infra` (mostly file moves + import fixes).
4. **Extract `execution-core`** from the server executor (pure functions first).
5. **Worker split** — `runtimes/` per language consuming `execution-core`; `agent/` lifecycle vs poller.
6. **Client `api/` split** — break `ApiClient` into domain clients over a thin core.
7. **Delete client executor duplication** — drive status from SSE.
8. **Split oversized views** (`FlowDetail`, `FlowEditor`) — opportunistic.

Steps 1–2 deliver most of the "clean MVC" feel for the least risk. 4 + 7 kill the triplicate
execution bug. 5 + 6 finish the structure.

### Verify with the graph after each phase
```
/graphify . --update
```
Success signals: `getCollection` edge count drops (61 → split across repos), `ApiClient` betweenness
falls, and the "Worker Node Executor" / "Worker Job Processor" cohesion scores rise.
