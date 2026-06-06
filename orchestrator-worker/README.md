# Orchestrator Worker

Remote execution agent for the Orchestrator platform. Self-registers with the central server, polls for jobs, executes them in isolated child processes, and streams logs back in real time.

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  Orchestrator Server  (orchestrator-webpanel)        │
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌─────────────────┐  │
│  │  Flow DB  │──►│ Executor │──►│  Worker Router  │  │
│  └──────────┘   └──────────┘   └────────┬────────┘  │
└───────────────────────────────────────── │ ──────────┘
                                           │ HTTP polling
┌───────────────────────────────────────── │ ──────────┐
│  orchestrator-worker                     │           │
│                                          ▼           │
│  ┌──────────┐   ┌──────────┐   ┌─────────────────┐  │
│  │  agent   │──►│  poll()  │◄──│   /workers/:id  │  │
│  └──────────┘   └────┬─────┘   │   /jobs         │  │
│                      │         └─────────────────┘  │
│               ┌──────▼──────┐                        │
│               │ executeNode │                        │
│               │  (per lang) │                        │
│               └─────────────┘                        │
└──────────────────────────────────────────────────────┘
```

1. On startup the agent registers with the orchestrator via `POST /api/v1/workers/register` and receives a bearer token used for every other call.
2. It long-polls `GET /api/v1/workers/:id/jobs` for pending jobs.
3. For each job it downloads any referenced artifacts by `sha` (`GET /api/v1/workers/:id/jobs/:jobId/artifacts/:sha`), extracts them to the execution dir (auto-unpacking archives), then executes the node in a child process and posts the result back.
4. A separate heartbeat loop keeps the worker's `status` as `online` in the server.
5. Artifacts are cleaned up after the job (unless `ORCHESTRATOR_KEEP_ARTIFACTS=true`, or a sibling job from the same flow is still running).
6. On `SIGINT`/`SIGTERM` the agent deregisters cleanly.

## Supported Node Types

| Type | Runtime | Notes |
|---|---|---|
| `javascript` / `jsbackend` | Node.js (current process's `node`) | ESM module, has access to `input`, `output`, named variables |
| `python` | `python` on `$PATH` | Reads/writes JSON via temp files; variables round-tripped as JSON |
| `groovy` | `java -jar groovyExec.jar` | Requires Java 11+; `groovyExec.jar` must be present |
| `powershell` | `powershell.exe` (Win) / `pwsh` (Linux/Mac) | Variables loaded from JSON; output via `$env:OUTPUT` file path |
| `batch` | `cmd.exe` | Windows only; variables exported as `%VAR%` env vars |
| `bash` / `shell` | `bash` / `sh` on `$PATH` | POSIX shells; variables exported as env vars |
| `playwright` | Node.js + Playwright Chromium | Requires `playwright` browser binaries (`npx playwright install`) |
| `variable` | — | Returns the named variable value; no subprocess |
| `comment` / `goto` | — | Pass-through; no execution |

Each runner:
- Wraps user code with boilerplate that injects `input` and named flow variables.
- Streams stdout/stderr back to the server as `log`/`error` events.
- Writes output and updated variable values via temp files in `ORCHESTRATOR_WORK_DIR/inbox/`.
- Cleans up all temp files on completion (success or error).

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Build — not required for dev
npm run build

# 3. Start in dev mode (ts-node, no build needed)
ORCHESTRATOR_URL=http://localhost:3939 WORKER_NAME=my-worker npm run dev

# 4. Or run the compiled agent
ORCHESTRATOR_URL=http://localhost:3939 WORKER_NAME=my-worker npm start
```

The worker appears in the orchestrator UI (`/workers`) within a few seconds of starting.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ORCHESTRATOR_URL` | `http://localhost:3939` | Base URL of the orchestrator server |
| `WORKER_NAME` | `test` | Display name shown in the UI |
| `WORKER_REGISTRATION_SECRET` | *(dev default)* | Must match `WORKER_REGISTRATION_SECRET` on the server |
| `POLL_INTERVAL_MS` | `2000` | How often to check for new jobs |
| `HEARTBEAT_INTERVAL_MS` | `10000` | How often to send a keepalive to the server |
| `WORKER_EXECUTION_MODE` | `parallel` | Job pickup: `parallel` (take jobs as they arrive) or `sequential` (finish the current flow's jobs first) |
| `WORKER_MAX_HTTP_SIZE` | `100mb` | Max HTTP request/response size; must be ≥ server `JSON_BODY_LIMIT` (artifacts inflate as base64) |
| `ORCHESTRATOR_WORK_DIR` | `process.cwd()` | Directory used for temp files and the `inbox/` folder |
| `ORCHESTRATOR_EXECUTION_DIR` | `=WORK_DIR` | Working dir (cwd) for spawned node processes and artifact extraction |
| `ORCHESTRATOR_KEEP_ARTIFACTS` | `false` | `true` keeps extracted artifacts after a run |
| `ORCHESTRATOR_FAIL_ON_LOG_ERROR` | `false` | `true` forces FAILED when output contains `ERROR`/`FAILED` even on exit 0 |
| `GROOVY_JAR` | `<WORK_DIR>/groovyExec.jar` | Path to the Groovy executor JAR |

## File Structure

```
orchestrator-worker/
├── src/
│   ├── agent.ts              # Registration, polling, heartbeat, job dispatch
│   └── executor/
│       └── nodeExecutor.ts   # Per-language child-process runners
├── groovyExec.jar            # Bundled Groovy runtime shim
├── package.json
└── tsconfig.json
```

## External Dependencies

| Dependency | Required for |
|---|---|
| **Java 11+** | Groovy nodes (`java` on `$PATH`) |
| **Python** | Python nodes (`python` on `$PATH`) |
| **Playwright browsers** | Playwright nodes — run `npx playwright install chromium` once |
| **PowerShell / pwsh** | PowerShell nodes |

If a runtime is missing the job fails with a clear error; other node types are unaffected.

## Variable Passing

Flow variables are injected into each script before execution and captured back after. The mechanism differs per language:

- **JS**: variables are declared at the top of the script and captured into a JSON file via a `finally` block.
- **Python**: variables loaded from a JSON sidecar file; captured back to the same file after user code.
- **Groovy**: variables parsed from JSON via `JsonSlurper`; captured back via `JsonOutput`.
- **PowerShell**: loaded from a JSON file via `ConvertFrom-Json`; captured back via `ConvertTo-Json`.
- **Batch**: simple string variables only, passed as `SET NAME=value` lines; no capture back.

## Security Notes

- The registration secret (`WORKER_REGISTRATION_SECRET`) is the only gate protecting the registration endpoint. Use a strong random value in production and keep it out of source control.
- Executed code runs as the same OS user as the worker process. Scope permissions accordingly.
- Temp files in `inbox/` are deleted immediately after each job; they are not encrypted on disk.
