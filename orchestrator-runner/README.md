# orchestrator-runner

Minimal standalone Rust CLI for Orchestrator `.or` flows. It follows the webpanel's JSON graph and traversal conventions and the worker's language-runtime I/O conventions.

Windows release builds embed `assets/icon.ico` plus Explorer version properties. Product and file versions come from `Cargo.toml`; the current executable identity is **Orchestrator Runner**, version **0.1.0**.

From the repository root, `build-runner.bat` builds and moves `runner.exe` into `release/`, together with `groovyExec.jar`.

```powershell
cargo build --release --manifest-path orchestrator-runner/Cargo.toml
Copy-Item orchestrator-runner/target/release/runner.exe C:/etl/runner.exe
C:/etl/runner.exe C:/flows/nightly.or  # executes and embeds nightly.or
C:/etl/runner.exe                       # executes the embedded flow
```

The process changes its working directory to the directory containing `runner.exe`. Node stdout and stderr are printed with ANSI-tagged lines; set `NO_COLOR=1` to disable colors.

## Compatibility boundary

Supported locally: JavaScript/Backend JS (system Node), Python, PowerShell, Batch, Shell/Bash, Groovy, variable, comment, goto, inline nested-flow nodes, retries/backoff, `continue` error policy, artifacts, shared variables, starter nodes, predecessor ordering, and goto input forwarding. Backend JS bare imports are resolved from the execution/work directories; `ORCHESTRATOR_NODE_MODULES` may point to an additional `node_modules` directory. Groovy uses a system `groovy` command when available and otherwise runs `java -jar groovyExec.jar`; place the JAR beside the runner or set `GROOVY_JAR`. `${{ secrets.NAME }}` reads `NAME` from the runner environment.

Server-only references cannot be autonomous: `flowRef` database lookups, worker assignment, server secret storage, git branches, schedules, execution history, and SSE are intentionally not part of the runner. A nested flow must be present in the flow node's `data.code`.

The executable trailer is replaced, not accumulated, whenever a new `.or` file is supplied. Keep `runner.exe` writable; on Windows the runner atomically renames the running image, installs the updated image at the original path, and removes the old image on the next start.

## Keeping it synchronized

When `orchestrator-webpanel/server/src/domain/execution/flowExecutor.ts` changes graph traversal or `orchestrator-worker/src/runtimes/` changes runtime conventions, update the corresponding runner modules:

- `src/model.rs` — `.or` parsing
- `src/executor.rs` — graph traversal and policies
- `src/runtime.rs` — language wrappers and process behavior

Run `cargo test --manifest-path orchestrator-runner/Cargo.toml` and exercise the repository's `demo-flows/*.or` fixtures after compatibility changes.
