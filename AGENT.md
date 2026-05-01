# CLAUDE.md

Guidance for coding agents working in this repository.

## Project Overview

Orchestrator is a browser-based workflow orchestration app. The frontend is React + TypeScript + Vite; the backend is a Node.js API server that executes jobs and hosts the flow library API.

The main user workflow is:
- Manage flows at `/#/flows`
- Edit a flow at `/#/flows/:id?tab=edit`
- Inspect executions at `/#/flows/:id?tab=executions&exec=:executionId`
- Manage workers at `/#/workers`

The standalone legacy route `/#/editor` redirects to `/#/flows`. The graph editor is still reused inside flow edit mode.

## Current Capabilities

- Visual node graph editing with ReactFlow
- Flow library with local persistence and worker sync
- Per-flow worker assignment, duplication, deletion, scheduling, import, and export
- `.or` import/export for flow definitions
- Per-flow edit sessions with compact tabs
- Nested flow nodes linked to sessions
- Autosave in flow edit mode for graph changes
- Per-flow and global execution history
- Execution log console with ANSI color rendering, auto-scroll, log export, and editable execution display names
- Backend-generated execution ids start with `YYYYMMDDHHMMSS_...`
- Dark/light theme support

## Commands

```bash
npm install
npm run dev        # Vite frontend at http://localhost:5173
npm run backend    # API server at http://localhost:3000
npm run build      # TypeScript + Vite production build
```

There is no configured test suite. Use `npm run build` as the baseline verification command.

## Important Files

| Purpose | File |
| --- | --- |
| App routes | `src/App.tsx` |
| Flow library layout | `src/components/flows/AppLayout.tsx` |
| Flow list | `src/components/flows/FlowsList.tsx` |
| Flow detail edit/executions tabs | `src/components/flows/FlowDetail.tsx` |
| Global executions list | `src/components/flows/ExecutionsList.tsx` |
| Workers UI | `src/components/flows/WorkersPanel.tsx` |
| Embedded graph editor | `src/components/FlowEditor.tsx` |
| Editor toolbar | `src/components/FlowEditorToolbar.tsx` |
| Session tabs | `src/components/SessionTabs.tsx` |
| Flow node creation modal | `src/components/FlowNodeCreationModal.tsx` |
| Graph session store | `src/store/sessionStore.ts` |
| Graph editor store hook | `src/store/sessionFlowStore.ts` |
| Flow library store | `src/store/flowLibraryStore.ts` |
| Worker API utilities | `src/utils/workerApi.ts` |
| Backend server | `backend/api-server.cjs` |

## Architecture Notes

### Flow Library

The flow library is separate from editor sessions.

- `flowLibraryStore.ts` persists flow metadata and execution history in localStorage.
- Worker sync is handled through `workerApi.ts`.
- Backend flow endpoints live under `/api/v1/flows` and `/api/v1/executions`.
- Flow edit mode creates or reuses sessions tagged with `linkedFlowId`.
- Autosave writes session graph state back to the flow library and worker.

### Sessions

`sessionStore.ts` owns editor sessions. Sessions may be global or tied to a flow via `linkedFlowId`.

When closing a flow-scoped active session, fallback selection must stay within the same flow. Do not switch to an unrelated flow session.

### Embedded Editor

`FlowEditor` supports:

```tsx
<FlowEditor embedded flowId={flow.id} />
```

In embedded mode:
- New/save/load file buttons are hidden.
- Run/stop flow buttons remain visible.
- Flow node sessions created from uploads are tagged with the parent `flowId`.

### Executions

Execution records keep the real `id` for lookup. A user-editable `displayName` may be stored locally for presentation/export filenames. Do not use `displayName` for API calls.

Execution logs should:
- Auto-scroll when new log lines arrive
- Render ANSI colors via `ansiToHtml`
- Export as plain text with ANSI stripped

## Node Types

Common node types include:
- `javascript`
- `jsbackend`
- `groovy`
- `batch`
- `powershell`
- `python`
- `playwright`
- `variable`
- `comment`
- `flow`
- `goto`

Add new node types in:
- `src/types/node.ts`
- `src/constants/nodeTypes.ts`
- `src/store/executors/nodeExecutor.ts`
- `backend/api-server.cjs` if backend execution is required

## Backend Notes

`backend/api-server.cjs` contains both generic job execution and flow library endpoints.

Important backend behaviors:
- `nowUid()` prefixes ids with `YYYYMMDDHHMMSS`.
- Flow definitions persist in `backend/flows-data`.
- The server supports session/job APIs and flow/execution APIs.
- Restart the backend after changing backend code.

## Coding Guidelines

- Prefer existing stores and component patterns over new abstractions.
- Keep flow library state separate from editor session state.
- Preserve real ids for API calls; use display labels only for UI.
- Use structured JSON for `.or` import/export.
- Run `npm run build` after TypeScript or route changes.
- Do not reintroduce legacy route behavior for `/#/editor`.
