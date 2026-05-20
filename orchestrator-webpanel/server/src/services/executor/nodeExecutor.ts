import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import kill from 'tree-kill';

// Resolve a bare ESM specifier (e.g. `playwright`) to an absolute file URL
// using every node_modules anchor we know about. Node's ESM resolver walks
// up only from the script directory, so scripts written to <WORK_DIR>/inbox
// can't find packages installed in the server's own node_modules tree.
// Rewriting `import x from 'name'` to `import x from 'file:///abs/path'`
// sidesteps the walk; nested dependencies still resolve normally because
// the resolved file is itself inside a real node_modules tree.
// Only resolve user-script bare imports against ORCHESTRATOR_WORK_DIR first,
// then ORCHESTRATOR_EXECUTION_DIR. Nothing else — pkg's `__dirname` is
// virtual (C:\snapshot\...) and process.cwd() is unpredictable when the
// binary runs as a service.
const bareResolver: (spec: string) => string | null = (() => {
  const anchors = [
    process.env.ORCHESTRATOR_WORK_DIR,
    process.env.ORCHESTRATOR_EXECUTION_DIR,
  ].filter((s): s is string => !!s);
  const requires: NodeRequire[] = [];
  for (const a of anchors) {
    try { requires.push(createRequire(path.join(a, 'noop.js'))); } catch { /* skip */ }
  }
  return (spec: string): string | null => {
    for (const r of requires) {
      try {
        const resolved = r.resolve(spec);
        if (resolved && fs.existsSync(resolved)) return resolved;
      } catch { /* try next anchor */ }
    }
    return null;
  };
})();

// Bare-specifier helpers shared by both rewriters.
function specToFileUrl(spec: string): string | null {
  if (!spec || /^(\.|\/|file:|node:|https?:|data:)/.test(spec)) return null;
  const resolved = bareResolver(spec);
  if (!resolved) return null;
  return 'file:///' + resolved.replace(/\\/g, '/');
}

// Rewrite static ESM imports of bare specifiers into dynamic `await import()`
// statements.
//
// Why not just rewrite the *string* in the import? Static `import { x } from
// 'file://.../index.js'` fails when the target is CJS — Node's CJS-named-export
// detector misses many real-world packages (Playwright among them), giving
// "Named export 'chromium' not found". Dynamic `await import()` of a CJS file
// always works: you get `{ default: module.exports }`. We then destructure
// against `default ?? namespace` so both CJS and true-ESM packages behave the
// same to the user.
//
// Supported user-source forms (top-level only; matches start of a line):
//   import 'X';
//   import D from 'X';
//   import * as N from 'X';
//   import { a, b as c } from 'X';
//   import D, { a } from 'X';
//   import D, * as N from 'X';
//   const M = await import('X');     // bare specifier inside dynamic import
//   export { x } from 'X';
function rewriteBareEsmImports(code: string): string {
  let n = 0;
  const tmp = () => `__esm_${++n}`;

  const renderNamed = (clause: string, src: string): string => {
    // `{ a, b as c }` → `{ a, b: c }`
    const m = clause.match(/^\{\s*([^}]*)\s*\}$/);
    if (!m) return '';
    const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const props = items.map(it => {
      const asM = it.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return asM ? `${asM[1]}: ${asM[2]}` : it;
    }).join(', ');
    return `const { ${props} } = (${src}.default && typeof ${src}.default === 'object') ? ${src}.default : ${src};`;
  };

  // Side-effect: `import 'X';`
  code = code.replace(/^[ \t]*import\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm, (m, spec) => {
    const url = specToFileUrl(spec);
    return url ? `await import(${JSON.stringify(url)});` : m;
  });

  // `import ... from 'X';`
  code = code.replace(/^[ \t]*import\s+([^'";]+?)\s+from\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm,
    (m, clauseRaw: string, spec: string) => {
      const url = specToFileUrl(spec);
      if (!url) return m;
      const v = tmp();
      const out: string[] = [`const ${v} = await import(${JSON.stringify(url)});`];

      let rest = clauseRaw.trim();
      let defaultName: string | null = null;

      if (!rest.startsWith('{') && !rest.startsWith('*')) {
        const commaIdx = rest.indexOf(',');
        if (commaIdx === -1) { defaultName = rest; rest = ''; }
        else { defaultName = rest.slice(0, commaIdx).trim(); rest = rest.slice(commaIdx + 1).trim(); }
      }
      if (defaultName) out.push(`const ${defaultName} = ${v}.default ?? ${v};`);
      if (rest.startsWith('*')) {
        const nsName = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1];
        if (nsName) out.push(`const ${nsName} = ${v};`);
      } else if (rest.startsWith('{')) {
        const namedSrc = renderNamed(rest, v);
        if (namedSrc) out.push(namedSrc);
      }
      return out.join('\n');
    });

  // `export ... from 'X';` — flatten to a const re-bind (rare in node-runner scripts).
  code = code.replace(/^[ \t]*export\s+(\{[^}]+\}|\*)\s+from\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm,
    (m, clause: string, spec: string) => {
      const url = specToFileUrl(spec);
      if (!url) return m;
      const v = tmp();
      // We can't `export` at non-top-level after rewrite. Just bind locally;
      // user scripts don't actually re-export from the runner wrapper.
      return `const ${v} = await import(${JSON.stringify(url)});`;
    });

  // Bare specifier inside dynamic `import('X')`.
  code = code.replace(/(\bimport\s*\(\s*)['"]([^'"]+)['"](\s*\))/g, (m, pre, spec, post) => {
    const url = specToFileUrl(spec);
    return url ? `${pre}${JSON.stringify(url)}${post}` : m;
  });

  return code;
}

/* ============================
   Config & Globals
   ============================ */

const WORK_DIR = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
const EXECUTION_DIR = process.env.ORCHESTRATOR_EXECUTION_DIR || WORK_DIR;
const INBOX = path.join(WORK_DIR, 'inbox');
const OUTBOX = path.join(WORK_DIR, 'outbox');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 200);
const STOP_CHECK_INTERVAL_MS = Number(process.env.STOP_CHECK_INTERVAL_MS ?? 500);
export const JS_BACKEND_TIMEOUT_MS = Number(process.env.JS_BACKEND_TIMEOUT_MS ?? 0);
export const DEFAULT_FLOW_TIMEOUT_MS = Number(process.env.DEFAULT_FLOW_TIMEOUT_MS ?? 0);

// When false, the server refuses to execute any node locally — every job must
// be dispatched to a remote worker. Top-level orchestration (flow parsing,
// nested-flow nodes) still runs in-process; only script-type nodes are gated.
export const SERVER_EXECUTION_ENABLED =
  String(process.env.ORCHESTRATOR_SERVER_EXECUTION_ENABLED ?? 'true').toLowerCase() !== 'false';

// When true, scan a job's log output for ERROR / FAILED tokens. If matched on
// an otherwise-successful run, flip the result to a failure so the flow stops.
// Pattern: word-boundary, case-sensitive ERROR or FAILED (commonly seen in
// language stack traces and CI conventions).
export const FAIL_ON_LOG_ERROR =
  String(process.env.ORCHESTRATOR_FAIL_ON_LOG_ERROR ?? 'false').toLowerCase() === 'true';

const LOG_ERROR_PATTERN = /\b(ERROR|FAILED)\b/;

export function detectLogErrorTrigger(text: string | null | undefined): string | null {
  if (!FAIL_ON_LOG_ERROR || !text) return null;
  const m = text.match(LOG_ERROR_PATTERN);
  return m ? `Log error trigger: matched '${m[0]}' in output (ORCHESTRATOR_FAIL_ON_LOG_ERROR=true)` : null;
}

[INBOX, OUTBOX].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

export const runningProcesses = new Map<string, ChildProcess>();
export const jobs = new Map<string, any>();
export const jobLogListeners = new Map<string, Set<any>>();
export const jobLogBuffers = new Map<string, any[]>();

// SSE listeners for execution node statuses: execId -> Set<res>
export const executionSSEListeners = new Map<string, Set<any>>();

// Latest emitted status payload per (execId, nodeId). Lets newly-connected SSE
// clients replay the current state of every node, so users who flip between
// executions don't lose the overlays. Persisted onto the execution record at
// completion (see flowExecutor.executeOrchestratorFlow).
export const executionNodeStatuses = new Map<string, Record<string, any>>();

export function emitJobLog(jobId: string, type: string, message: string, nodeId?: string | null): void {
  const entry = { type, message, nodeId: nodeId ?? null, timestamp: Date.now() };
  if (!jobLogBuffers.has(jobId)) jobLogBuffers.set(jobId, []);
  jobLogBuffers.get(jobId)!.push(entry);

  const listeners = jobLogListeners.get(jobId);
  if (listeners) {
    for (const res of listeners) {
      try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch { /* client gone */ }
    }
  }
}

export function emitNodeStatus(execId: string, nodeId: string, status: string, extra: object = {}): void {
  const payload = { execId, nodeId, status, ...extra, ts: Date.now() };

  // Remember the latest payload per node so a late-joining SSE listener
  // (e.g., user switched executions) can be brought back up to speed.
  if (!executionNodeStatuses.has(execId)) executionNodeStatuses.set(execId, {});
  executionNodeStatuses.get(execId)![nodeId] = payload;

  const listeners = executionSSEListeners.get(execId);
  if (listeners) {
    for (const res of listeners) {
      try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { }
    }
  }
}

export function cleanupJobLogs(jobId: string): void {
  const listeners = jobLogListeners.get(jobId);
  if (listeners) {
    for (const res of listeners) {
      try { res.end(); } catch { }
    }
    jobLogListeners.delete(jobId);
  }
  setTimeout(() => jobLogBuffers.delete(jobId), 60000);
}

/* ============================
   Utilities
   ============================ */

export function nowUid(): string {
  const n = process.hrtime.bigint();
  const d = new Date();
  const pad = (v: number, len = 2) => String(v).padStart(len, '0');
  const prefix = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate()), pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('');
  return `${prefix}_${n.toString(36)}`;
}

function normalizeOutput(v: any): any {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string') {
    const t = v.trim();
    try { return JSON.parse(t); } catch { return t || null; }
  }
  return v;
}

function normalizeInput(v: any): any {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    try { return JSON.parse(t); } catch { return t; }
  }
  return v;
}

function safeUnlinkSync(f: string): void {
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { }
}

function registerProcess(id: string, child: ChildProcess): void {
  runningProcesses.set(id, child);
}

function terminateProcess(id: string): void {
  const child = runningProcesses.get(id);
  if (child && child.pid) {
    try { kill(child.pid); } catch { }
  }
  runningProcesses.delete(id);
}

function shouldStopJob(nodeId: string, jobId: string | null): boolean {
  if (jobId) {
    const j = jobs.get(jobId);
    if (j && j.stopRequested) return true;
  }
  const stopPath = path.join(INBOX, `${nodeId}.stop`);
  return fs.existsSync(stopPath);
}

function cleanupStopSignal(id: string): void {
  safeUnlinkSync(path.join(INBOX, `${id}.stop`));
}

// Resolve an artifact's `name` to an absolute path strictly inside `targetDir`.
// Rejects:
//   - absolute paths (Windows drive, leading slash, UNC)
//   - parent traversal (`..` segments) that climb out of targetDir
//   - empty / whitespace-only names
// Returns null when the name is unsafe; callers should skip the artifact.
export function safeArtifactPath(name: string, targetDir: string): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Normalize separators first so Linux-style "../" on Windows is caught.
  const normalized = trimmed.replace(/\\/g, '/');
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) return null;
  const resolvedTarget = path.resolve(targetDir);
  const resolved = path.resolve(resolvedTarget, normalized);
  const rel = path.relative(resolvedTarget, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

export function extractArtifacts(artifacts: Array<{name: string; data: string}>, targetDir: string): string[] {
  const extracted: string[] = [];
  if (!artifacts || !artifacts.length) return extracted;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  for (const artifact of artifacts) {
    const destPath = safeArtifactPath(artifact.name, targetDir);
    if (!destPath) { console.warn(`[artifact] rejected unsafe name: ${artifact.name}`); continue; }
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const newData = Buffer.from(artifact.data, 'base64');
    if (fs.existsSync(destPath)) {
      const existing = fs.readFileSync(destPath);
      if (existing.equals(newData)) continue;
    }
    fs.writeFileSync(destPath, newData);
    extracted.push(destPath);
  }
  return extracted;
}

export function cleanupArtifacts(artifacts: Array<{name: string; data: string}>, targetDir: string): void {
  if (!artifacts || !artifacts.length) return;
  for (const artifact of artifacts) {
    const p = safeArtifactPath(artifact.name, targetDir);
    if (!p) continue;
    try { safeUnlinkSync(p); } catch { }
  }
}

function getNodeExecutablePath(): string {
  if (process.env.NODE_EXECUTABLE_PATH) return process.env.NODE_EXECUTABLE_PATH;
  // When packaged with pkg, process.execPath is the bundle itself, not a Node
  // runtime. Pkg's bundled Node 18 also can't `require()` ESM .mjs, and pkg
  // intercepts `spawn('node', ...)` to re-launch the bundle as Node — so a
  // bare 'node' string still routes back to the orchestrator binary.
  // Resolve to an absolute path of a real system Node so pkg's interceptor
  // can't touch it.
  if ((process as any).pkg) {
    const isWin = process.platform === 'win32';
    const exe = isWin ? 'node.exe' : 'node';
    const sep = isWin ? ';' : ':';

    // Walk every PATH entry (Windows env can be either PATH or Path).
    const pathStr = process.env.PATH || (process.env as any).Path || '';
    for (const dir of pathStr.split(sep)) {
      if (!dir) continue;
      const candidate = path.join(dir.replace(/^"|"$/g, ''), exe);
      try { if (fs.existsSync(candidate)) return candidate; } catch { /* skip */ }
    }

    // Fall back to `where node` / `which node` — the OS resolver knows about
    // installer-registered locations PATH might miss in our process env.
    try {
      const { execSync } = require('child_process');
      const cmd = isWin ? 'where node' : 'command -v node';
      const out = execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }) as string;
      const first = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    } catch { /* not on PATH */ }

    // Common install locations on Windows as a last resort.
    if (isWin) {
      const candidates = [
        'C:\\Program Files\\nodejs\\node.exe',
        'C:\\Program Files (x86)\\nodejs\\node.exe',
        process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node.exe'),
      ].filter(Boolean) as string[];
      for (const c of candidates) {
        try { if (fs.existsSync(c)) return c; } catch { /* skip */ }
      }
    }

    console.warn('[node-exec] No system Node found. Pkg-bundled server will fail to run .mjs scripts. Set NODE_EXECUTABLE_PATH to override.');
    return 'node';
  }
  return process.execPath;
}

const nodeExecutablePath = getNodeExecutablePath();

function resolveGroovyJar(): string {
  const workDir = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
  const candidates = [
    process.env.GROOVY_JAR,                              // explicit override
    path.join(workDir, 'groovyExec.jar'),                // WORK_DIR (extracted on startup)
    path.join(process.cwd(), 'groovyExec.jar'),          // next to binary
    path.join(__dirname, '../../groovyExec.jar'),        // dev: dist/
    path.join(__dirname, '../../..', 'groovyExec.jar'), // dev: server root
  ].filter(Boolean) as string[];
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
}

/* ============================
   Log Collector (for flow-level logs)
   ============================ */

export function createLogCollector(): { logs: { type: string; message: string }[]; restore: () => void } {
  const logs: { type: string; message: string }[] = [];
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logs.push({ type: 'log', message: msg });
    origLog(...args);
  };
  console.warn = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logs.push({ type: 'warn', message: msg });
    origWarn(...args);
  };
  console.error = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logs.push({ type: 'error', message: msg });
    origError(...args);
  };

  const restore = () => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  };

  return { logs, restore };
}

/* ============================
   Variable helpers
   ============================ */

export function sanitizeVariableName(name: string): string {
  return (name || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

export function collectFlowVariables(nodes: any[]): Record<string, any> {
  const vars: Record<string, any> = {};
  for (const n of nodes) {
    if (n?.data?.type === 'variable') {
      const rawValue = n.data.value || '';
      const key = sanitizeVariableName(n.data.label);
      try { vars[key] = JSON.parse(rawValue); }
      catch { vars[key] = rawValue; }
    }
  }
  return vars;
}

/* ============================
   Job finalization
   ============================ */

export function finalizeJob(id: string, result: any): void {
  try {
    runningProcesses.delete(id);
    // Promote ERROR/FAILED tokens in successful logs to a hard failure when the
    // operator has opted in via ORCHESTRATOR_FAIL_ON_LOG_ERROR.
    if (!result.error) {
      const trigger = detectLogErrorTrigger(result.log);
      if (trigger) result.error = trigger;
    }
    const job = jobs.get(id);
    if (job) {
      job.status = result.error ? 'failed' : 'completed';
      job.output = result.output;
      job.error = result.error;
      job.log = result.log;
      job.executionTime = result.executionTime;
      job.endTime = new Date().toISOString();
      if (result.variables && Object.keys(result.variables).length > 0) {
        job.variables = { ...(job.variables || {}), ...result.variables };
      }
    }
    cleanupJobLogs(id);
  } catch (err) {
    console.error(`Error during job finalize for ${id}:`, (err as Error).message);
  }
}

/* ============================
   Node runners
   ============================ */

type FinishFn = (result: { output: any; log: string | null; error: string | null; variables?: Record<string, any> }) => void;

function processJsNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, _execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null, flowNodeId: string | null = null): void {
  const emitNodeId = flowNodeId || id;
  const logs: string[] = [];
  const customConsole = {
    log: (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      logs.push(msg);
      if (jobId) emitJobLog(jobId, 'log', msg, emitNodeId);
    },
    warn: (...args: any[]) => {
      const msg = '[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      logs.push(msg);
      if (jobId) emitJobLog(jobId, 'log', msg, emitNodeId);
    },
    error: (...args: any[]) => {
      const msg = '[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      logs.push(msg);
      if (jobId) emitJobLog(jobId, 'error', msg, emitNodeId);
    },
  };

  const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
  let finished = false;
  const varNames = Object.keys(variables);
  const variableDeclarations = varNames.map(name => `let ${name} = __variables[${JSON.stringify(name)}];`).join('\n');
  const varCapture = varNames.map(name => `try { __variables[${JSON.stringify(name)}] = ${name}; } catch(e) {}`).join('\n');

  let stopCheckInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (shouldStopJob(id, jobId)) {
      clearInterval(stopCheckInterval!);
      stopCheckInterval = null;
      cleanupStopSignal(id);
      if (!finished) { finished = true; finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user' }); }
    }
  }, STOP_CHECK_INTERVAL_MS);

  try {
    const wrappedCode = `${variableDeclarations}\nlet __userReturn;\ntry {\n  __userReturn = await (async () => { ${code} })();\n} finally {\n  ${varCapture || '//'}\n}\nif (typeof process === "function") return await process(input);\nreturn __userReturn;`;
    const fn = new AsyncFunction('input', 'console', '__variables', wrappedCode);
    fn(input, customConsole, variables)
      .then((output: any) => {
        if (stopCheckInterval) { clearInterval(stopCheckInterval); }
        if (!finished) {
          finished = true;
          finish({ output: normalizeOutput(output), log: logs.length ? logs.join('\n').trim() : '', error: null, variables });
        }
      })
      .catch((err: any) => {
        if (stopCheckInterval) { clearInterval(stopCheckInterval); }
        if (!finished) {
          finished = true;
          finish({ output: null, log: logs.length ? logs.join('\n').trim() : '', error: err?.message || String(err), variables });
        }
      });
  } catch (err: any) {
    if (stopCheckInterval) { clearInterval(stopCheckInterval); }
    if (!finished) {
      finished = true;
      finish({ output: null, log: logs.length ? logs.join('\n').trim() : '', error: err?.message || String(err) });
    }
  }
}

function processGroovyNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null, flowNodeId: string | null = null): void {
  const emitNodeId = flowNodeId || id;
  const uid = nowUid();
  const tempGroovyPath = path.join(INBOX, `node_groovy_${uid}.groovy`);
  const tempInputPath = path.join(INBOX, `node_groovy_${uid}.input`);
  const tempOutputPath = path.join(INBOX, `node_groovy_${uid}.output`);
  const tempVariablesPath = path.join(INBOX, `node_groovy_${uid}.variables`);

  fs.writeFileSync(tempInputPath, JSON.stringify(input === undefined ? null : input), 'utf8');
  fs.writeFileSync(tempVariablesPath, JSON.stringify(variables), 'utf8');

  const inputPathGroovy = tempInputPath.replace(/\\/g, '/');
  const outputPathGroovy = tempOutputPath.replace(/\\/g, '/');
  const variablesPathGroovy = tempVariablesPath.replace(/\\/g, '/');
  const varNames = Object.keys(variables);
  const variableLoading = varNames.length > 0
    ? `def __variables = new groovy.json.JsonSlurper().parseText(new File('${variablesPathGroovy}').text)\n` + varNames.map(n => `def ${n} = __variables['${n}']`).join('\n')
    : '';
  const variableCapture = varNames.length > 0
    ? `def __capturedVars = [${varNames.map(n => `'${n}': ${n}`).join(', ')}]\nnew File('${variablesPathGroovy}').text = groovy.json.JsonOutput.toJson(__capturedVars)`
    : '';

  const groovyCode = `
def smartParse = { s -> try { (s?.trim()?.startsWith('{') || s?.trim()?.startsWith('[')) && s?.contains('"') ? new groovy.json.JsonSlurper().parseText(s) : Eval.me(s) } catch(e) { s } }
${variableLoading}
input = smartParse(new File('${inputPathGroovy}').text)
def output = ""
${code}
${variableCapture}
def asJson = { obj -> try { groovy.json.JsonOutput.toJson(obj) } catch(e) { groovy.json.JsonOutput.toJson([value: obj?.toString(), error: e.toString()]) } }
new File('${outputPathGroovy}').text = asJson(output)`.trim();

  try { fs.writeFileSync(tempGroovyPath, groovyCode, 'utf8'); }
  catch (err: any) { finish({ output: null, log: null, error: err.message, variables: {} }); return; }

  const child = spawn('java', ['-jar', resolveGroovyJar(), tempGroovyPath, 'lib'], { cwd: execCwd, shell: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, emitNodeId); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, emitNodeId); });
  child.on('close', (exitCode: number | null) => {
    runningProcesses.delete(id);
    safeUnlinkSync(tempGroovyPath);
    let outputValue: any = null;
    try {
      if (fs.existsSync(tempOutputPath)) { const r = fs.readFileSync(tempOutputPath, 'utf8').trim(); try { outputValue = JSON.parse(r); } catch { outputValue = r; } safeUnlinkSync(tempOutputPath); }
    } catch { }
    safeUnlinkSync(tempInputPath);
    let modifiedVariables: Record<string, any> = {};
    try { if (fs.existsSync(tempVariablesPath)) { modifiedVariables = JSON.parse(fs.readFileSync(tempVariablesPath, 'utf8')); safeUnlinkSync(tempVariablesPath); } } catch { }
    if (typeof outputValue === 'string') outputValue = outputValue.trim();
    outputValue = normalizeOutput(outputValue);
    const errorInStdout = /Exception|Error|Caused by|groovy\.lang|java\.lang/i.test(stdout) ? stdout : '';
    finish({ log: errorInStdout === '' ? stdout.trim() : null, error: ((stderr || '') + (exitCode !== 0 ? `Exit code: ${exitCode}` : '') + errorInStdout).trim() || null, output: outputValue, variables: modifiedVariables });
  });
  child.on('error', (err: Error) => { runningProcesses.delete(id); safeUnlinkSync(tempGroovyPath); safeUnlinkSync(tempInputPath); finish({ output: null, log: null, error: err.message, variables: {} }); });
  registerProcess(id, child);
  const si = setInterval(() => { if (shouldStopJob(id, jobId)) { clearInterval(si); terminateProcess(id); cleanupStopSignal(id); finish({ output: null, log: 'Process terminated', error: 'Process terminated by user', variables: {} }); } }, STOP_CHECK_INTERVAL_MS);
  child.on('exit', () => clearInterval(si));
}

function processBatchNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null, flowNodeId: string | null = null): void {
  const emitNodeId = flowNodeId || id;
  const uid = nowUid();
  const tempBatchPath = path.join(INBOX, `node_batch_${uid}.bat`);
  const tempOutputPath = path.join(INBOX, `node_batch_${uid}.output`);
  const inputVar = input !== undefined ? String(input).replace(/\\"/g, '\\\\\\"') : '';
  const variableEnvVars = Object.entries(variables).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([name, val]) => `set ${name}=${String(val).replace(/"/g, '\\"')}`).join('\n');
  const batchCode = `@echo off\n${variableEnvVars}\nset INPUT="${inputVar}"\nset OUTPUT="${tempOutputPath}"\n${code}\r\n`;
  try { fs.writeFileSync(tempBatchPath, batchCode, 'utf8'); }
  catch (err: any) { finish({ output: null, log: null, error: err.message, variables: {} }); return; }
  const child = spawn('cmd', ['/C', tempBatchPath], { cwd: execCwd, shell: false });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, emitNodeId); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, emitNodeId); });
  child.on('error', (err: Error) => { runningProcesses.delete(id); safeUnlinkSync(tempBatchPath); finish({ output: null, log: null, error: err.message, variables: {} }); });
  child.on('close', (exitCode: number | null) => {
    runningProcesses.delete(id); safeUnlinkSync(tempBatchPath);
    let outputValue: any = null;
    try { if (fs.existsSync(tempOutputPath)) { outputValue = fs.readFileSync(tempOutputPath, 'utf8').trim(); safeUnlinkSync(tempOutputPath); } } catch { }
    if (!outputValue && stdout) outputValue = stdout.trim();
    try { if (typeof outputValue === 'string' && (outputValue.startsWith('{') || outputValue.startsWith('['))) outputValue = JSON.parse(outputValue); } catch { }
    outputValue = normalizeOutput(outputValue);
    const errorInStdout = /error|not recognized|failed|exception|not found/i.test(stdout) ? stdout : '';
    finish({ log: errorInStdout === '' ? stdout.trim() : null, error: ((stderr || '') + (exitCode !== 0 ? `Exit code: ${exitCode}` : '') + errorInStdout).trim() || null, output: outputValue, variables: {} });
  });
  registerProcess(id, child);
  const si = setInterval(() => { if (shouldStopJob(id, jobId)) { clearInterval(si); terminateProcess(id); cleanupStopSignal(id); finish({ output: null, log: 'Process terminated', error: 'Process terminated by user', variables: {} }); } }, STOP_CHECK_INTERVAL_MS);
  child.on('exit', () => clearInterval(si));
}

function processJsBackendNode(id: string, code: string, input: any, finish: FinishFn, codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null, flowNodeId: string | null = null): void {
  const emitNodeId = flowNodeId || id;
  const uid = nowUid();
  const tempId = `node_jsbackend_${uid}`;
  const tempScriptPath = path.join(INBOX, `${tempId}.mjs`);
  const tempOutputPath = path.join(INBOX, `${tempId}.output`);
  const tempVariablesPath = path.join(INBOX, `${tempId}.variables`);

  if (codeFilePath) {
    const baseFolder = path.dirname(codeFilePath);
    const importRegex = /import\s+[\s\S]*?\s+from\s+['"](.+?\.(?:js|cjs|mjs))['"]/g;
    code = code.replace(importRegex, (m: string, importPath: string) => {
      if (importPath.startsWith('.') || importPath.startsWith('/')) {
        return m.replace(importPath, 'file://' + path.join(baseFolder, importPath).replace(/\\/g, '/'));
      }
      return m;
    });
  }

  const varNames = Object.keys(variables);
  const variableDeclarations = varNames.map(n => `let ${n} = __variables["${n}"];`).join('\n');
  const variableCapture = varNames.length > 0 ? `const __capturedVariables = { ${varNames.join(', ')} };\nfs.writeFileSync(${JSON.stringify(tempVariablesPath)}, JSON.stringify(__capturedVariables), 'utf8');` : '';
  // Rewrite bare ESM imports → absolute file URLs so the script resolves
  // packages even though it lives outside the server's node_modules tree.
  const userCode = rewriteBareEsmImports(code);
  const codeWithInput = `let output = "";\nconst input = ${JSON.stringify(input)};\nconst __variables = ${JSON.stringify(variables)};\nimport fs from 'fs';\n${variableDeclarations}\n${userCode}\n${variableCapture}\nfs.writeFileSync(${JSON.stringify(tempOutputPath)}, JSON.stringify(output), 'utf8');\n`;
  fs.writeFileSync(tempScriptPath, codeWithInput, 'utf8');

  // Spawn the user script's Node process directly (no shell). Going through
  // cmd.exe corrupted the file-descriptor table Playwright's pipe mode needs.
  // Leave stdio at defaults (pipe) and don't pass `windowsHide`: both can
  // leave the script process without an attached console session, which
  // breaks Edge's `--remote-debugging-pipe` handshake on Windows and surfaces
  // as `browserType.launch: Target page, context or browser has been closed`.
  const child = spawn(nodeExecutablePath, [tempScriptPath], {
    cwd: execCwd,
    shell: false,
    timeout: JS_BACKEND_TIMEOUT_MS || undefined,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, emitNodeId); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, emitNodeId); });
  child.on('close', (exitCode: number | null) => {
    runningProcesses.delete(id); safeUnlinkSync(tempScriptPath);
    let outputValue: any = null;
    try { if (fs.existsSync(tempOutputPath)) { const r = fs.readFileSync(tempOutputPath, 'utf8').trim(); safeUnlinkSync(tempOutputPath); try { outputValue = JSON.parse(r); } catch { outputValue = r; } } } catch { }
    let modifiedVariables: Record<string, any> = {};
    try { if (fs.existsSync(tempVariablesPath)) { modifiedVariables = JSON.parse(fs.readFileSync(tempVariablesPath, 'utf8')); safeUnlinkSync(tempVariablesPath); } } catch { }
    if (typeof outputValue === 'string') outputValue = outputValue.trim();
    outputValue = normalizeOutput(outputValue);
    const errorInStdout = /error|not found|failed|exception/i.test(stdout) ? stdout : '';
    finish({ log: errorInStdout === '' ? stdout.trim() : null, error: ((stderr || '') + (exitCode !== 0 ? `Exit code: ${exitCode}` : '') + errorInStdout).trim() || null, output: outputValue, variables: modifiedVariables });
  });
  child.on('error', (err: Error) => { runningProcesses.delete(id); safeUnlinkSync(tempScriptPath); finish({ output: null, log: null, error: err.message, variables: {} }); });
  registerProcess(id, child);
  const si = setInterval(() => { if (shouldStopJob(id, jobId)) { clearInterval(si); terminateProcess(id); cleanupStopSignal(id); finish({ output: null, log: 'Process terminated', error: 'Process terminated by user', variables: {} }); } }, STOP_CHECK_INTERVAL_MS);
  child.on('exit', () => clearInterval(si));
}

function processPowershellNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null, flowNodeId: string | null = null): void {
  const emitNodeId = flowNodeId || id;
  const uid = nowUid();
  const tempPs1Path = path.join(INBOX, `node_ps_${uid}.ps1`);
  const tempOutputPath = path.join(INBOX, `node_ps_${uid}.output`);
  const tempVariablesPath = path.join(INBOX, `node_ps_${uid}.variables.json`);
  const inputVar = input !== undefined ? String(input).replace(/"/g, '""') : '';
  const varNames = Object.keys(variables);
  try { fs.writeFileSync(tempVariablesPath, JSON.stringify(variables), 'utf8'); } catch { }
  const variableLoading = varNames.length > 0
    ? `$__variablesJson = Get-Content -Path "${tempVariablesPath.replace(/\\/g, '\\\\')}" -Raw | ConvertFrom-Json\n` + varNames.map(n => `$${n} = $__variablesJson.${n}`).join('\n')
    : '';
  const variableCapture = varNames.length > 0
    ? `$__capturedVars = @{\n${varNames.map(n => `    '${n}' = $${n}`).join('\n')}\n}\n$__capturedVars | ConvertTo-Json -Depth 10 | Set-Content -Path "${tempVariablesPath.replace(/\\/g, '\\\\')}"`
    : '';
  const psCode = `${variableLoading}\n$env:INPUT="${inputVar}"\n$env:OUTPUT="${tempOutputPath}"\n${code}\n${variableCapture}\n`;
  try { fs.writeFileSync(tempPs1Path, psCode, 'utf8'); }
  catch (err: any) { finish({ output: null, log: null, error: err.message, variables: {} }); return; }
  const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', tempPs1Path], { cwd: execCwd, shell: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, emitNodeId); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, emitNodeId); });
  child.on('close', (exitCode: number | null) => {
    runningProcesses.delete(id); safeUnlinkSync(tempPs1Path);
    let outputValue: any = null;
    try { if (fs.existsSync(tempOutputPath)) { outputValue = fs.readFileSync(tempOutputPath, 'utf8').trim(); safeUnlinkSync(tempOutputPath); } } catch { }
    let modifiedVariables: Record<string, any> = {};
    try { if (fs.existsSync(tempVariablesPath)) { modifiedVariables = JSON.parse(fs.readFileSync(tempVariablesPath, 'utf8')); safeUnlinkSync(tempVariablesPath); } } catch { }
    if (!outputValue && stdout) outputValue = stdout.trim();
    if (typeof outputValue === 'string') { try { outputValue = JSON.parse(outputValue.trim()); } catch { } }
    outputValue = normalizeOutput(outputValue);
    const errorInStdout = /error|not recognized|failed|exception|not found/i.test(stdout) ? stdout : '';
    finish({ log: errorInStdout === '' ? stdout.trim() : null, error: ((stderr || '') + (exitCode !== 0 ? `Exit code: ${exitCode}` : '') + errorInStdout).trim() || null, output: outputValue, variables: modifiedVariables });
  });
  child.on('error', (err: Error) => { runningProcesses.delete(id); safeUnlinkSync(tempPs1Path); finish({ output: null, log: null, error: err.message, variables: {} }); });
  registerProcess(id, child);
  const si = setInterval(() => { if (shouldStopJob(id, jobId)) { clearInterval(si); terminateProcess(id); cleanupStopSignal(id); finish({ output: null, log: 'Process terminated', error: 'Process terminated by user', variables: {} }); } }, STOP_CHECK_INTERVAL_MS);
  child.on('exit', () => clearInterval(si));
}

function processPythonNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null, flowNodeId: string | null = null): void {
  const emitNodeId = flowNodeId || id;
  const uid = nowUid();
  const tempPyPath = path.join(INBOX, `node_python_${uid}.py`);
  const tempInputPath = path.join(INBOX, `node_python_${uid}.input`);
  const tempOutputPath = path.join(INBOX, `node_python_${uid}.output`);
  const tempVariablesPath = path.join(INBOX, `node_python_${uid}.variables.json`);
  fs.writeFileSync(tempInputPath, JSON.stringify(input === undefined ? null : input), 'utf8');
  fs.writeFileSync(tempVariablesPath, JSON.stringify(variables), 'utf8');
  const ip = tempInputPath.replace(/\\/g, '/'), op = tempOutputPath.replace(/\\/g, '/'), vp = tempVariablesPath.replace(/\\/g, '/');
  const varNames = Object.keys(variables);
  const variableLoading = varNames.length > 0 ? varNames.map(n => `${n} = __variables.get('${n}')`).join('\n') : '';
  const variableCapture = varNames.length > 0 ? `__captured_vars = {${varNames.map(n => `'${n}': ${n}`).join(', ')}}\nwith open('${vp}', 'w') as __f:\n    json.dump(__captured_vars, __f)` : '';
  const pythonCode = `import json\nwith open('${ip}', 'r') as __f:\n    input = json.load(__f)\nwith open('${vp}', 'r') as __f:\n    __variables = json.load(__f)\n${variableLoading}\noutput = None\n${code}\n${variableCapture}\nwith open('${op}', 'w') as __f:\n    json.dump(output, __f)\n`;
  try { fs.writeFileSync(tempPyPath, pythonCode, 'utf8'); }
  catch (err: any) { finish({ output: null, log: null, error: err.message, variables: {} }); return; }
  const child = spawn('python', [tempPyPath], { cwd: execCwd, shell: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, emitNodeId); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, emitNodeId); });
  child.on('close', (exitCode: number | null) => {
    runningProcesses.delete(id); safeUnlinkSync(tempPyPath); safeUnlinkSync(tempInputPath);
    let outputValue: any = null;
    try { if (fs.existsSync(tempOutputPath)) { const r = fs.readFileSync(tempOutputPath, 'utf8').trim(); try { outputValue = JSON.parse(r); } catch { outputValue = r; } safeUnlinkSync(tempOutputPath); } } catch { }
    let modifiedVariables: Record<string, any> = {};
    try { if (fs.existsSync(tempVariablesPath)) { modifiedVariables = JSON.parse(fs.readFileSync(tempVariablesPath, 'utf8')); safeUnlinkSync(tempVariablesPath); } } catch { }
    if (typeof outputValue === 'string') outputValue = outputValue.trim();
    outputValue = normalizeOutput(outputValue);
    const errorInStdout = /Traceback|Error|Exception/i.test(stdout) ? stdout : '';
    finish({ log: errorInStdout === '' ? stdout.trim() : null, error: ((stderr || '') + (exitCode !== 0 ? `Exit code: ${exitCode}` : '') + errorInStdout).trim() || null, output: outputValue, variables: modifiedVariables });
  });
  child.on('error', (err: Error) => { runningProcesses.delete(id); safeUnlinkSync(tempPyPath); safeUnlinkSync(tempInputPath); finish({ output: null, log: null, error: err.message, variables: {} }); });
  registerProcess(id, child);
  const si = setInterval(() => { if (shouldStopJob(id, jobId)) { clearInterval(si); terminateProcess(id); cleanupStopSignal(id); finish({ output: null, log: 'Process terminated', error: 'Process terminated by user', variables: {} }); } }, STOP_CHECK_INTERVAL_MS);
  child.on('exit', () => clearInterval(si));
}

/* ============================
   Job processing dispatcher
   ============================ */

export function processJob(job: any): void {
  const { jobId, type, codeFilePath, input, timeout } = job;
  job.input = normalizeInput(input);
  job.status = 'running';

  // Refuse local execution when the operator has disabled server-side runs.
  // 'flow' jobs are pure orchestration and remain allowed.
  if (!SERVER_EXECUTION_ENABLED && !job.workerId && type !== 'flow') {
    finalizeJob(jobId, {
      output: null,
      log: null,
      error: `Server execution disabled (ORCHESTRATOR_SERVER_EXECUTION_ENABLED=false). Job ${jobId} (${type}) requires an assigned worker.`,
    });
    return;
  }

  let execCwd = EXECUTION_DIR;
  try {
    if (job.basePath && fs.existsSync(job.basePath)) execCwd = job.basePath;
    else if (codeFilePath && fs.existsSync(path.dirname(codeFilePath))) execCwd = path.dirname(codeFilePath);
  } catch { }
  if (!fs.existsSync(execCwd)) { try { fs.mkdirSync(execCwd, { recursive: true }); } catch { execCwd = WORK_DIR; } }

  if (codeFilePath) {
    try {
      const resolved = path.isAbsolute(codeFilePath) ? codeFilePath : path.resolve(job.basePath || process.cwd(), codeFilePath);
      if (fs.existsSync(resolved)) job.code = fs.readFileSync(resolved, 'utf8');
    } catch (err: any) { console.error(`Error loading code from file ${codeFilePath}:`, err.message); }
  }

  const effectiveTimeout = timeout && timeout !== Infinity && timeout > 0 ? timeout : 0;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  if (effectiveTimeout > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      terminateJobAndChildren(jobId);
      finalizeJob(jobId, { output: null, log: null, error: `Execution timed out after ${effectiveTimeout / 1000}s` });
    }, effectiveTimeout);
  }

  const finish: FinishFn = (result) => {
    if (timedOut) return;
    if (timeoutId) clearTimeout(timeoutId);
    finalizeJob(jobId, result);
  };

  const code = job.code || '';
  const vars = job.variables || {};

  // Worker dispatch path: for script-type nodes with a workerId, send to the
  // assigned worker instead of running locally. JavaScript stays local because
  // it shares flowVariables in-process. Flow type stays here so that the
  // orchestrator parses the sub-graph and dispatches each inner script node.
  const REMOTE_TYPES = new Set(['powershell', 'batch', 'python', 'groovy', 'jsbackend', 'playwright', 'shell', 'bash']);
  if (job.workerId && REMOTE_TYPES.has(type)) {
    (async () => {
      try {
        const { dispatchToWorker } = await import('../../routes/workers');
        const remoteNode = {
          type,
          data: { code, input: job.input, variables: vars, timeout: effectiveTimeout ? Math.ceil(effectiveTimeout / 1000) : 0 },
        };
        const emitChan = job.execId || jobId;
        const emitNode = job.nodeId || jobId;
        emitJobLog(emitChan, 'log', `[remote] dispatching ${type} node to worker ${job.workerId}`, emitNode);
        const { output, variables: workerVars } = await dispatchToWorker(job.workerId, remoteNode, emitChan, emitNode);
        emitJobLog(emitChan, 'log', `[remote] node ${emitNode} completed on worker`, emitNode);
        finish({ output, log: null, error: null, variables: workerVars || {} });
      } catch (err: any) {
        finish({ output: null, log: null, error: `Worker dispatch failed: ${err.message}` });
      }
    })();
    return;
  }

  if (type === 'flow') {
    const flowContent = code.trim();
    if (!flowContent) { finish({ output: null, log: null, error: 'No flow content provided' }); return; }
    let flowData: any;
    try { flowData = JSON.parse(flowContent); } catch (e: any) { finish({ output: null, log: null, error: `Invalid flow JSON: ${e.message}` }); return; }
    if (!flowData?.nodes || !flowData?.edges) { finish({ output: null, log: null, error: 'Invalid flow: missing nodes/edges' }); return; }
    (async () => {
      const { logs, restore } = createLogCollector();
      try {
        const { executeInlineFlow, parseFlowContent: pfc } = await import('./flowExecutor');
        const tempFlow = pfc(flowContent);
        // For nested flow nodes, the parent execution's jobId is on `job.execId`
        // (set in flowExecutor.executeRegularNode); use it for SSE/log routing so
        // events reach the listener. Top-level flows use the flow job id directly.
        const ssePath = job.execId || jobId;
        const result = await executeInlineFlow(tempFlow, job.input, [], job.basePath || process.cwd(), effectiveTimeout || DEFAULT_FLOW_TIMEOUT_MS, ssePath, job.workerId || null, job.parentNodeId || null, job.artifacts);
        restore();
        const logMessages = logs.map(l => l.type === 'error' ? `ERROR: ${l.message}` : l.message).join('\n');
        finish({ output: result, log: logMessages || 'Successfully executed flow', error: null });
      } catch (err: any) { restore(); finish({ output: null, log: null, error: `Error executing flow: ${err.message}` }); }
    })();
  } else if (type === 'groovy') {
    processGroovyNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, job.execId || jobId, job.nodeId || null);
  } else if (type === 'batch') {
    processBatchNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, job.execId || jobId, job.nodeId || null);
  } else if (type === 'jsbackend' || type === 'playwright') {
    processJsBackendNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, job.execId || jobId, job.nodeId || null);
  } else if (type === 'powershell') {
    processPowershellNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, job.execId || jobId, job.nodeId || null);
  } else if (type === 'python') {
    processPythonNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, job.execId || jobId, job.nodeId || null);
  } else {
    processJsNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, job.execId || jobId, job.nodeId || null);
  }
}

export function terminateJobAndChildren(jobId: string): void {
  terminateProcess(jobId);
  const job = jobs.get(jobId);
  if (job) job.stopRequested = true;
  // A flow execution spawns transient sub-jobs (one per node run, tagged with
  // execId === the flow's jobId). Flag them and kill their running child
  // processes too, so a kill takes effect immediately even mid-node or mid-retry.
  for (const [id, j] of jobs) {
    if (id !== jobId && j && j.execId === jobId) {
      j.stopRequested = true;
      terminateProcess(id);
    }
  }
}
