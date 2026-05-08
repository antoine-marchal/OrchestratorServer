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

1. On startup the agent registers with the orchestrator via `POST /api/v1/workers/register`.
2. Every `POLL_INTERVAL_MS` it calls `GET /api/v1/workers/:id/jobs` to fetch pending jobs.
3. Each job is acknowledged, executed in a child process, and the result posted back.
4. A separate heartbeat loop keeps the worker's `status` as `online` in the server.
5. On `SIGINT`/`SIGTERM` the agent deregisters cleanly.

## Supported Node Types

| Type | Runtime | Notes |
|---|---|---|
| `javascript` / `jsbackend` | Node.js (current process's `node`) | ESM module, has access to `input`, `output`, named variables |
| `python` | `python` on `$PATH` | Reads/writes JSON via temp files; variables round-tripped as JSON |
| `groovy` | `java -jar groovyExec.jar` | Requires Java 11+; `groovyExec.jar` must be present |
| `powershell` | `powershell.exe` (Win) / `pwsh` (Linux/Mac) | Variables loaded from JSON; output via `$env:OUTPUT` file path |
| `batch` | `cmd.exe` | Windows only; variables exported as `%VAR%` env vars |
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
| `ORCHESTRATOR_WORK_DIR` | `process.cwd()` | Directory used for temp files and the `inbox/` folder |
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
