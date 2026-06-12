# Refactoring Recommendations — Orchestrator

_Generated from a graphify knowledge-graph analysis of the codebase (2026-06-11)._
_Graph: 1409 nodes · 2567 edges · 99 communities · 168 files / ~190k words._

This document ranks refactoring opportunities by **impact ÷ risk**. Each item cites the
graph or LOC evidence that surfaced it, explains why it matters, and gives a concrete action.

> **Status (2026-06-12):** Most items below are now **done**.
> - **P0 triplicate executor** → shared execution-core extracted (by the maintainer).
> - **P1 ApiClient god object** → ✅ split into `client/src/api/` per-domain clients over a thin transport.
> - **P1 repository layer** → ✅ `server/src/data/repositories/*`, one per entity; `getCollection` confined to `BaseRepository` + storage adapters.
> - **P2 oversized files** → partial: `AdminLayout` helpers extracted; `FlowDetail`/`FlowEditor` deep splits still pending (no client tests — do with manual QA).
> - **P2 duplicate build scripts** → ✅ consolidated into `scripts/lib/{patch-exe,prepare-pkg}.mjs`.
> - **P3 isolated nodes / tsconfig drift** → ✅ shared `tsconfig.base.json` for the Node backends.
> - Also added beyond the original list: server **validation layer** (`http/validators/` + central `errorHandler`).
>
> See `ARCHITECTURE_TARGET.md` and `documentation/ARCHITECTURE.md` for the realized structure.

---

## How to read this

- **God node** = a node with abnormally many edges. It is a core abstraction *or* a god object
  that too much of the system depends on. High edge count + high betweenness = a change-amplifier.
- **Cohesion** = how tightly a community's nodes connect internally (0–1). Low cohesion means the
  module groups unrelated things — a split candidate.
- **Community** = an auto-detected cluster of related code. Duplicate community names are a strong
  copy-paste signal.

---

## P0 — Triplicate execution engine (highest impact)

**Evidence.**
- Three independent implementations of node/flow execution:
  - `orchestrator-worker/src/executor/nodeExecutor.ts` (552 LOC) — `runProcess`, `runPython`,
    `runGroovy`, `runPowershell`, `runBatch`, `runShell`, `runJsBackend`.
  - `orchestrator-webpanel/server/src/services/executor/nodeExecutor.ts` (1057 LOC) +
    `flowExecutor.ts` (881 LOC) — job processing, artifact handling, in-process JS.
  - `orchestrator-webpanel/client/src/store/executors/nodeExecutor.ts` (555 LOC) +
    `flowExecutor.ts` (370 LOC) — client-side flow execution.
- The graph isolated communities **"Worker Node Executor" (cohesion 0.08)** and
  **"Worker Job Processor" (cohesion 0.07)** — the two weakest-cohesion code communities in the repo.
- An architecture concept node literally named **"Server/Worker Executor Sync Pitfall"** exists —
  the team already documented that these implementations drift apart.

**Why it matters.** Execution semantics (status transitions, log streaming, artifact extraction,
error detection, scope/timing) are forked across three places. Every behavior change must be made
3× and kept in sync by hand — the documented "sync pitfall." This is the single largest source of
latent correctness bugs.

**Action.**
1. Extract a shared package `@orchestrator/execution-core` containing the runtime-neutral pieces:
   node status state machine, `scopeKey`/timing logic, artifact extraction, log encode/decode,
   error-trigger detection. The graph already isolates these as the **"Execution Timing & Scope"**
   community (cohesion 0.27 — clean and liftable) and **"Execution Logs & Jobs API"**.
2. Make worker and server consume that package instead of re-implementing it. The per-language
   `runX` process spawners stay worker-side; the server should *dispatch*, not re-run.
3. The client `store/executors/*` should drive a UI state model only — it should not duplicate
   server execution rules. Replace with server-driven status via the existing SSE log stream
   ("SSE Live Log Stream" concept node).

**Effort:** large. **Risk:** medium (well-bounded by extracting pure functions first).
**Payoff:** removes the #1 structural hazard; ~1000+ LOC of duplication collapses.

---

## P1 — `ApiClient` god object

**Evidence.** `ApiClient` — 41 edges, **highest betweenness of any UI node (0.027)**. The graph's
top suggested question is literally _"Why does ApiClient connect API Client to Flow Editor Canvas,
File Tree, Session Stores, App Layout, Users Panel, Flow Library, Schedule Panel, Admin Layout,
Editor Layout, Workers Panel, Secrets Panel, Execution Graph, Auth Pages, Schedule Modal?"_ — it
bridges **14 communities**. The class has **45 methods** in one file
(`orchestrator-webpanel/client/src/utils/apiClient.ts`).

**Why it matters.** Every UI feature imports the same fat client, so any change to it risks every
screen, and the file is a permanent merge-conflict hotspot. It is the client-side equivalent of a
god class.

**Action.** Split `ApiClient` into domain clients that share one thin transport/auth core:
`flowsApi`, `executionsApi`, `workersApi`, `authApi`, `secretsApi`, `usersApi`, `scheduleApi`.
Keep token handling (`getJwt`/`setJwt`) and the axios instance in one base. Each UI community then
imports only the slice it needs, cutting the betweenness bridge.

**Effort:** medium (mechanical, method-by-method). **Risk:** low.

---

## P1 — No repository layer: `getCollection()` is everywhere

**Evidence.** `getCollection()` — **61 edges, the most connected node in the entire graph.** It
anchors the **"Server Bootstrap & Artifact GC"** and **"DB Collection Abstraction"** communities and
is reached from routes, services, executors, and GC alike. Source:
`orchestrator-webpanel/server/src/services/db/index.ts`.

**Why it matters.** Raw collection access is scattered across the server, so the NeDB↔Mongo
abstraction (`ICollection`, `MongoCollection`, `NeDBCollection`) leaks into business logic.
Query shapes are duplicated and there is no seam for caching, validation, or migration.

**Action.** Introduce per-entity repositories (`FlowRepo`, `ExecutionRepo`, `UserRepo`,
`ArtifactRepo`, `WorkerRepo`) that own their collection and expose intent-named methods. Callers
depend on the repo, not on `getCollection('...')` string keys. This converts the single 61-edge hub
into ~6 focused, independently testable nodes.

**Effort:** medium. **Risk:** low–medium (do it incrementally, one entity at a time).

---

## P2 — Oversized files / components to break up

LOC hotspots that also map to large or low-cohesion graph communities:

| File | LOC | Community | Action |
|------|-----|-----------|--------|
| `client/src/components/flows/FlowDetail.tsx` | 1521 | App Layout & Lists | Split into header, tabs, execution panel, and version subviews. Biggest file in repo. |
| `server/src/services/executor/nodeExecutor.ts` | 1057 | Worker Job Processor (0.07) | Covered by **P0** — extract shared core. |
| `server/src/services/executor/flowExecutor.ts` | 881 | Flow Executor & Event Bus | Covered by **P0**. |
| `client/src/components/FlowEditor.tsx` | 858 | Flow Editor Canvas (0.12) | Separate canvas, toolbar (already its own community "Editor Toolbar & History"), and panels. |
| `client/src/components/flows/FlowsList.tsx` | 855 | App Layout & Lists | Extract row, filters, and create-modal; modal is already a distinct node. |
| `client/src/components/admin/AdminLayout.tsx` | 806 | Admin Layout UI (0.20) | Split per admin tab (Users/Secrets/Workers/API keys) — tabs already separate nodes. |
| `client/src/store/flowLibraryStore.ts` | 599 | Session & Flow Stores | Separate library CRUD from versioning/diff state. |

**Why it matters.** These files exceed comprehension limits and concentrate churn. Each already
contains internal seams the graph detected as separate nodes — the split lines are pre-drawn.

**Effort:** medium, per file. **Risk:** low (presentational extraction).

---

## P2 — Duplicated build/packaging scripts

**Evidence.** The graph produced *duplicate communities* — a textbook copy-paste signal:
- **"EXE Patch Script"** and **"EXE Patch Script (dup)"** — identical node sets
  (`exeData`, `FILE_VERSION`, `ICON`, `outData`, `pkg`, version triple).
- **"Package Prep Script"** and **"Package Prep Script 2"** — overlapping (`dest`, `__dirname`,
  `root`, candidates).
- **"package.json (dup)"** and **"Worker package.json"** share the same dependency shape.

**Why it matters.** Two copies of the EXE-patching and package-prep logic drift independently;
a packaging fix lands in one and not the other.

**Action.** Consolidate into a single parameterized script under a shared `scripts/` (or a tiny
internal `tools` package) invoked with target args (win/linux, app name). Dedupe the prep scripts
the same way.

**Effort:** small. **Risk:** low.

---

## P3 — Isolate the Presentation Deck engine

**Evidence.** `DeckStage` — **54 edges, the #2 god node** — yet it lives in
`documentation/presentation/deck-stage.js` and forms the self-contained **"Presentation Deck Engine"**
and **"Standalone Deck Builder"** communities (cohesion 0.076). It does not connect to the
application code at all.

**Why it matters.** A large, highly-connected subsystem that is unrelated to the product inflates
the graph and the repo's apparent surface area. It is a slide-deck tool, not part of Orchestrator.

**Action.** Move `documentation/presentation/` to its own folder/repo or mark it clearly as a
non-shipping tool (own package.json, excluded from app builds). No code change to the engine — just
boundary clarity.

**Effort:** small. **Risk:** none.

---

## P3 — Dead code & config noise (535 isolated nodes)

**Evidence.** Knowledge-gap report: **535 isolated nodes** (≤1 connection), led by `name`,
`version`, `private`, `description`, `main` — i.e. package.json fields and many `compilerOptions`
across **six** separate TSConfig communities (server/app/node/root/refs).

**Why it matters.** Most are config noise (expected), but isolated *code* nodes in this set are
dead-code candidates. Six near-identical tsconfig variants also suggest config drift.

**Action.**
1. Introduce a shared base `tsconfig.base.json` and have each package `extends` it — collapses the
   six TSConfig communities into one base + thin overrides.
2. Run `graphify query` on isolated *code* nodes (not config) to confirm true orphans, then prune.

**Effort:** small (tsconfig) / ongoing (dead-code sweep). **Risk:** low.

---

## Suggested sequencing

1. **P1 ApiClient split** and **P2 build-script dedup** — quick, low-risk, immediate churn relief.
2. **P1 repository layer** — incremental, unblocks testing.
3. **P0 execution-core extraction** — the big one; do it after the repo layer gives clean data seams.
4. **P2 component splits** and **P3 cleanup** — opportunistic, alongside feature work.

---

## Re-running this analysis

The graph lives in `graphify-out/`. After refactoring, re-run:

```
/graphify . --update
```

Then re-check that god-node edge counts dropped (ApiClient, getCollection) and that the
"Worker Node Executor" / "Worker Job Processor" cohesion scores rose — those are the quantitative
success signals for P0 and P1.
