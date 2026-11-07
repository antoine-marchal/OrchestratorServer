# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Internal teams running a self-hosted automation platform. Three roles: **admin** (everything, incl. users/schedules/triggers), **operator** (build and run flows, manage own executions, create secrets), **viewer** (read-only). Two jobs overlap in the same people:
- **Operating** — checking health: what failed, what is running, which workers are up, what fires next.
- **Building** — getting back to the flows they own or recently ran, editing them in the visual editor, re-running.

The post-login home serves both jobs equally, tailored to the signed-in user: their own flows (owner) and their own executions (triggeredUser) come first, platform-wide context second.

## Product Purpose
Orchestrator is a self-hosted automation platform: a visual DAG flow editor (JS, Python, Groovy, PowerShell, Batch, Shell, subflows, conditions, Playwright), triggered by cron, event, HTTP API or on demand, with live log streaming in the browser. Heavy or OS-specific work is delegated to remote stateless **workers** that self-register over HTTP. Success = flows run reliably and people notice failures fast.

## Positioning
Each flow is versioned in an internal git repo (editor saves are commits, branches, clone/push/pull with a standard git client), runs in multiple **variants** (worker × branch) scheduled independently, with content-addressed **artifacts** — all in one self-hosted repository.

## Operating Context
Used on desktop browsers inside a company network, often with SSO (CAS proxy auth). Users keep the panel open while flows run; data refreshes by polling. Execution history is synced from the server and cached client-side.

## Capabilities and Constraints
- Frontend: React 18 + Vite + Tailwind + CSS custom-property design tokens (`tc-*` classes, dark/light theme), lucide-react icons, HashRouter.
- Data available client-side: flows (owner, namespace, lastExecution, schedule, variants), executions (status, triggeredBy, triggeredUser, worker, branch, start/duration), workers (status), schedules.
- Execution statuses: RUNNING, SUCCESS, FAILED, KILLED, QUEUED. Triggers: manual, cron, event, api, schedule.
- Dashboard stats default window: last 7 days (selector 24h / 7d / 30d).
- All roles see the same dashboard; run/re-run actions hidden for roles that cannot execute.
- Product docs and README are written in French; UI copy is English.

## Brand Commitments
Name "Orchestrator", logo mark `<O⚡rchestrator/>` in mono type with the accent-coloured bolt O. Developer-tool voice: page titles styled as tags (`<Executions />`), `// comment`-style section captions, monospace for ids, durations and counts.

## Evidence on Hand
Screenshots of existing pages in `documentation/presentation/screenshots/`. No usage analytics or SLAs exist; do not invent uptime or performance claims.

## Product Principles
1. Failures surface first — a red run is never more than one glance away.
2. Personal before global — show the signed-in user's flows and runs before the platform at large.
3. Every number links to the list that explains it.
4. Dense but calm: an operator tool, not a marketing page.
