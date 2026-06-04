import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import kill from 'tree-kill';

// Build a single shell command line from an executable + args.
// `spawn(cmd, args, { shell: true })` is deprecated (Node DEP0190): the args
// array is concatenated into the shell line unescaped. When we need a shell
// (Windows PATH/PATHEXT lookup of `python`/`java`/`powershell`) we pass one
// pre-quoted string instead, which also fixes paths containing spaces.
// Mirrors server's nodeExecutor.toShellCommand.
function toShellCommand(cmd: string, args: string[]): string {
  const quote = (a: string) =>
    a === '' || /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
  return [cmd, ...args].map(quote).join(' ');
}

// Resolve a bare module specifier (e.g. `playwright`) to an absolute file URL,
// trying every node_modules anchor we know about. Node ESM walks up only from
// the script's directory, so scripts written to WORK_DIR/inbox can't resolve
// packages installed in the worker process's own node_modules. Resolving here
// — once — and rewriting the user code to `import x from 'file:///...'` makes
// the import succeed regardless of where the script lives.
// See server's nodeExecutor.getNodeExecutablePath for the full rationale.
// Pkg-bundled workers must spawn a real system Node — `process.execPath`
// would be the worker binary and pkg intercepts `spawn('node', ...)`.
function getNodeExecutablePath(): string {
  if (process.env.NODE_EXECUTABLE_PATH) return process.env.NODE_EXECUTABLE_PATH;
  if ((process as any).pkg) {
    const isWin = process.platform === 'win32';
    const exe = isWin ? 'node.exe' : 'node';
    const sep = isWin ? ';' : ':';
    const pathStr = process.env.PATH || (process.env as any).Path || '';
    for (const dir of pathStr.split(sep)) {
      if (!dir) continue;
      const candidate = path.join(dir.replace(/^"|"$/g, ''), exe);
      try { if (fs.existsSync(candidate)) return candidate; } catch { /* skip */ }
    }
    try {
      const { execSync } = require('child_process');
      const cmd = isWin ? 'where node' : 'command -v node';
      const out = execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }) as string;
      const first = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    } catch { /* not on PATH */ }
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
    console.warn('[worker:node-exec] No system Node found. Pkg-bundled worker will fail to run .mjs. Set NODE_EXECUTABLE_PATH to override.');
    return 'node';
  }
  return process.execPath;
}
const NODE_EXEC_PATH = getNodeExecutablePath();

// Only resolve user-script bare imports against ORCHESTRATOR_WORK_DIR first,
// then ORCHESTRATOR_EXECUTION_DIR.
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

function specToFileUrl(spec: string): string | null {
  if (!spec || /^(\.|\/|file:|node:|https?:|data:)/.test(spec)) return null;
  const resolved = bareResolver(spec);
  if (!resolved) return null;
  return 'file:///' + resolved.replace(/\\/g, '/');
}

// See server's nodeExecutor.rewriteBareEsmImports for the rationale; this
// must stay in sync. We rewrite static `import` to dynamic `await import()`
// because the resolved file is often CJS and Node's static named-export
// detector trips on packages like Playwright with `Named export 'chromium'
// not found`. Dynamic import always yields `{ default: module.exports }`.
function rewriteBareEsmImports(code: string): string {
  let n = 0;
  const tmp = () => `__esm_${++n}`;

  const renderNamed = (clause: string, src: string): string => {
    const m = clause.match(/^\{\s*([^}]*)\s*\}$/);
    if (!m) return '';
    const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const props = items.map(it => {
      const asM = it.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return asM ? `${asM[1]}: ${asM[2]}` : it;
    }).join(', ');
    return `const { ${props} } = (${src}.default && typeof ${src}.default === 'object') ? ${src}.default : ${src};`;
  };

  code = code.replace(/^[ \t]*import\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm, (m, spec) => {
    const url = specToFileUrl(spec);
    return url ? `await import(${JSON.stringify(url)});` : m;
  });

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

  code = code.replace(/^[ \t]*export\s+(\{[^}]+\}|\*)\s+from\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm,
    (m, _clause: string, spec: string) => {
      const url = specToFileUrl(spec);
      if (!url) return m;
      const v = tmp();
      return `const ${v} = await import(${JSON.stringify(url)});`;
    });

  code = code.replace(/(\bimport\s*\(\s*)['"]([^'"]+)['"](\s*\))/g, (m, pre, spec, post) => {
    const url = specToFileUrl(spec);
    return url ? `${pre}${JSON.stringify(url)}${post}` : m;
  });

  return code;
}

const WORK_DIR = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
const EXECUTION_DIR = process.env.ORCHESTRATOR_EXECUTION_DIR || WORK_DIR;
const INBOX = path.join(WORK_DIR, 'inbox');
const GROOVY_JAR = process.env.GROOVY_JAR || path.join(WORK_DIR, 'groovyExec.jar');

if (!fs.existsSync(INBOX)) fs.mkdirSync(INBOX, { recursive: true });

export type LogStreamFn = (type: 'log' | 'error', message: string) => void;
export type NodeResult = { output: any; variables: Record<string, any> };

function nowUid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function safeUnlink(f: string) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { } }

// When ORCHESTRATOR_FAIL_ON_LOG_ERROR=true, scan combined stdout+stderr for an
// ERROR/FAILED token after the process exits cleanly. If matched, synthesise a
// non-zero exit code so downstream runX throws and the node is reported failed.
const FAIL_ON_LOG_ERROR =
  String(process.env.ORCHESTRATOR_FAIL_ON_LOG_ERROR ?? 'false').toLowerCase() === 'true';
const LOG_ERROR_PATTERN = /\b(ERROR|FAILED)\b/;

function normalizeOutput(v: any): any {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string') {
    const t = v.trim();
    try { return JSON.parse(t); } catch { return t || null; }
  }
  return v;
}

interface RunOpts {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdinData?: string;
  timeoutMs?: number;
  onLog?: LogStreamFn;
  shell?: boolean;
}

function runProcess(cmd: string, args: string[], opts: RunOpts): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const useShell = opts.shell ?? false;
    const child = useShell
      ? spawn(toShellCommand(cmd, args), {
          cwd: opts.cwd || EXECUTION_DIR,
          env: { ...process.env, ...opts.env },
          shell: true,
        })
      : spawn(cmd, args, {
          cwd: opts.cwd || EXECUTION_DIR,
          env: { ...process.env, ...opts.env },
          shell: false,
        });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; opts.onLog?.('log', t); });
    child.stderr?.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; opts.onLog?.('error', t); });

    let timer: NodeJS.Timeout | null = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (child.pid) kill(child.pid);
        resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', exitCode: -1 });
      }, opts.timeoutMs);
    }

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      let exitCode = code ?? 0;
      let finalStderr = stderr;
      if (FAIL_ON_LOG_ERROR && exitCode === 0) {
        const m = (stdout + '\n' + stderr).match(LOG_ERROR_PATTERN);
        if (m) {
          exitCode = 1;
          finalStderr = (stderr ? stderr + '\n' : '') + `[log-error-trigger] matched '${m[0]}' (ORCHESTRATOR_FAIL_ON_LOG_ERROR=true)`;
        }
      }
      resolve({ stdout, stderr: finalStderr, exitCode });
    });

    if (opts.stdinData !== undefined) { child.stdin?.write(opts.stdinData); child.stdin?.end(); }
  });
}

/* ============================
   Per-language runners — each mirrors the orchestrator's wrapping logic
   so user code can reference `input`, `output`, and named variables.
   ============================ */

async function runJsBackend(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_jsb_${uid}.mjs`);
  const outputPath = path.join(INBOX, `worker_jsb_${uid}.output`);
  const variablesPath = path.join(INBOX, `worker_jsb_${uid}.variables`);

  const varNames = Object.keys(variables);
  const varDecl = varNames.map(n => `let ${n} = __variables[${JSON.stringify(n)}];`).join('\n');
  const varCapture = varNames.length > 0
    ? `try { fs.writeFileSync(${JSON.stringify(variablesPath)}, JSON.stringify({ ${varNames.join(', ')} }), 'utf8'); } catch {}`
    : '';

  // Rewrite bare specifiers in the user's code so ESM resolution works even
  // when the script lives outside any node_modules tree.
  const userCode = rewriteBareEsmImports(code);

  const wrapped = `import fs from 'fs';
let output = "";
const input = ${JSON.stringify(input)};
const __variables = ${JSON.stringify(variables)};
${varDecl}
${userCode}
${varCapture}
fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(output), 'utf8');
`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stderr } = await runProcess(NODE_EXEC_PATH, [scriptPath], { timeoutMs, onLog });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);

    let output: any = null;
    if (fs.existsSync(outputPath)) {
      const raw = fs.readFileSync(outputPath, 'utf8').trim();
      try { output = JSON.parse(raw); } catch { output = raw; }
    }
    let updatedVars: Record<string, any> = {};
    if (fs.existsSync(variablesPath)) {
      try { updatedVars = JSON.parse(fs.readFileSync(variablesPath, 'utf8')); } catch { }
    }
    return { output: normalizeOutput(output), variables: updatedVars };
  } finally {
    safeUnlink(scriptPath); safeUnlink(outputPath); safeUnlink(variablesPath);
  }
}

async function runPython(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_py_${uid}.py`);
  const inputPath = path.join(INBOX, `worker_py_${uid}.input`);
  const outputPath = path.join(INBOX, `worker_py_${uid}.output`);
  const variablesPath = path.join(INBOX, `worker_py_${uid}.variables.json`);

  fs.writeFileSync(inputPath, JSON.stringify(input ?? null), 'utf8');
  fs.writeFileSync(variablesPath, JSON.stringify(variables), 'utf8');
  const ip = inputPath.replace(/\\/g, '/'), op = outputPath.replace(/\\/g, '/'), vp = variablesPath.replace(/\\/g, '/');

  const varNames = Object.keys(variables);
  const varLoad = varNames.map(n => `${n} = __variables.get(${JSON.stringify(n)})`).join('\n');
  const varCapture = varNames.length > 0
    ? `with open(${JSON.stringify(vp)}, 'w') as __f:\n    json.dump({${varNames.map(n => `${JSON.stringify(n)}: ${n}`).join(', ')}}, __f)`
    : '';

  const wrapped = `import json
with open(${JSON.stringify(ip)}, 'r') as __f:
    input = json.load(__f)
with open(${JSON.stringify(vp)}, 'r') as __f:
    __variables = json.load(__f)
${varLoad}
output = None
${code}
${varCapture}
with open(${JSON.stringify(op)}, 'w') as __f:
    json.dump(output, __f)
`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stderr } = await runProcess('python', [scriptPath], { timeoutMs, onLog, shell: true });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);

    let output: any = null;
    if (fs.existsSync(outputPath)) {
      const raw = fs.readFileSync(outputPath, 'utf8').trim();
      try { output = JSON.parse(raw); } catch { output = raw; }
    }
    let updatedVars: Record<string, any> = {};
    if (fs.existsSync(variablesPath)) {
      try { updatedVars = JSON.parse(fs.readFileSync(variablesPath, 'utf8')); } catch { }
    }
    return { output: normalizeOutput(output), variables: updatedVars };
  } finally {
    safeUnlink(scriptPath); safeUnlink(inputPath); safeUnlink(outputPath); safeUnlink(variablesPath);
  }
}

async function runGroovy(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  if (!fs.existsSync(GROOVY_JAR)) throw new Error(`groovyExec.jar not found at ${GROOVY_JAR}`);
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_groovy_${uid}.groovy`);
  const inputPath = path.join(INBOX, `worker_groovy_${uid}.input`);
  const outputPath = path.join(INBOX, `worker_groovy_${uid}.output`);
  const variablesPath = path.join(INBOX, `worker_groovy_${uid}.variables`);

  fs.writeFileSync(inputPath, JSON.stringify(input ?? null), 'utf8');
  fs.writeFileSync(variablesPath, JSON.stringify(variables), 'utf8');
  const ip = inputPath.replace(/\\/g, '/'), op = outputPath.replace(/\\/g, '/'), vp = variablesPath.replace(/\\/g, '/');

  const varNames = Object.keys(variables);
  const varLoad = varNames.length > 0
    ? `def __variables = new groovy.json.JsonSlurper().parseText(new File('${vp}').text)\n` + varNames.map(n => `def ${n} = __variables['${n}']`).join('\n')
    : '';
  const varCapture = varNames.length > 0
    ? `def __captured = [${varNames.map(n => `'${n}': ${n}`).join(', ')}]\nnew File('${vp}').text = groovy.json.JsonOutput.toJson(__captured)`
    : '';

  const wrapped = `def smartParse = { s -> try { (s?.trim()?.startsWith('{') || s?.trim()?.startsWith('[')) && s?.contains('"') ? new groovy.json.JsonSlurper().parseText(s) : Eval.me(s) } catch(e) { s } }
${varLoad}
input = smartParse(new File('${ip}').text)
def output = ""
${code}
${varCapture}
def asJson = { obj -> try { groovy.json.JsonOutput.toJson(obj) } catch(e) { groovy.json.JsonOutput.toJson([value: obj?.toString(), error: e.toString()]) } }
new File('${op}').text = asJson(output)`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stdout, stderr } = await runProcess('java', ['-jar', GROOVY_JAR, scriptPath, 'lib'], { timeoutMs, onLog, shell: true });
    const errInStdout = /Exception|Error|Caused by|groovy\.lang|java\.lang/i.test(stdout) ? stdout : '';
    if (exitCode !== 0 || errInStdout) throw new Error(stderr || errInStdout || `Process exited with code ${exitCode}`);

    let output: any = null;
    if (fs.existsSync(outputPath)) {
      const raw = fs.readFileSync(outputPath, 'utf8').trim();
      try { output = JSON.parse(raw); } catch { output = raw; }
    }
    let updatedVars: Record<string, any> = {};
    if (fs.existsSync(variablesPath)) {
      try { updatedVars = JSON.parse(fs.readFileSync(variablesPath, 'utf8')); } catch { }
    }
    return { output: normalizeOutput(output), variables: updatedVars };
  } finally {
    safeUnlink(scriptPath); safeUnlink(inputPath); safeUnlink(outputPath); safeUnlink(variablesPath);
  }
}

async function runPowershell(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_ps_${uid}.ps1`);
  const outputPath = path.join(INBOX, `worker_ps_${uid}.output`);
  const variablesPath = path.join(INBOX, `worker_ps_${uid}.variables.json`);

  fs.writeFileSync(variablesPath, JSON.stringify(variables), 'utf8');
  const inputVar = input !== undefined && input !== null ? String(input).replace(/"/g, '""') : '';
  const varNames = Object.keys(variables);
  const escVarPath = variablesPath.replace(/\\/g, '\\\\');

  const varLoad = varNames.length > 0
    ? `$__variablesJson = Get-Content -Path "${escVarPath}" -Raw | ConvertFrom-Json\n` + varNames.map(n => `$${n} = $__variablesJson.${n}`).join('\n')
    : '';
  const varCapture = varNames.length > 0
    ? `$__captured = @{\n${varNames.map(n => `    '${n}' = $${n}`).join('\n')}\n}\n$__captured | ConvertTo-Json -Depth 10 | Set-Content -Path "${escVarPath}"`
    : '';

  const wrapped = `${varLoad}
$env:INPUT="${inputVar}"
$env:OUTPUT="${outputPath.replace(/"/g, '`"')}"
${code}
${varCapture}
`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const cmd = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const { exitCode, stderr, stdout } = await runProcess(cmd, ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', scriptPath], { timeoutMs, onLog, shell: true });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);

    let output: any = null;
    if (fs.existsSync(outputPath)) {
      output = fs.readFileSync(outputPath, 'utf8').trim();
    } else if (stdout) {
      output = stdout.trim();
    }
    if (typeof output === 'string') {
      try { output = JSON.parse(output); } catch { /* leave as string */ }
    }
    let updatedVars: Record<string, any> = {};
    if (fs.existsSync(variablesPath)) {
      try { updatedVars = JSON.parse(fs.readFileSync(variablesPath, 'utf8')); } catch { }
    }
    return { output: normalizeOutput(output), variables: updatedVars };
  } finally {
    safeUnlink(scriptPath); safeUnlink(outputPath); safeUnlink(variablesPath);
  }
}

async function runBatch(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  if (process.platform !== 'win32') throw new Error('Batch nodes only supported on Windows');
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_bat_${uid}.bat`);
  const outputPath = path.join(INBOX, `worker_bat_${uid}.output`);

  const inputVar = input !== undefined && input !== null ? String(input).replace(/\\"/g, '\\\\\\"') : '';
  const variableEnvVars = Object.entries(variables)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([name, val]) => `set ${name}=${String(val).replace(/"/g, '\\"')}`)
    .join('\r\n');

  const wrapped = `@echo off\r\n${variableEnvVars}\r\nset INPUT="${inputVar}"\r\nset OUTPUT="${outputPath}"\r\n${code}\r\n`;
  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stderr, stdout } = await runProcess('cmd.exe', ['/c', scriptPath], { timeoutMs, onLog });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);

    let output: any = null;
    if (fs.existsSync(outputPath)) {
      output = fs.readFileSync(outputPath, 'utf8').trim();
    } else if (stdout) {
      output = stdout.trim();
    }
    if (typeof output === 'string') {
      try { if (output.startsWith('{') || output.startsWith('[')) output = JSON.parse(output); } catch { }
    }
    return { output: normalizeOutput(output), variables: {} };
  } finally {
    safeUnlink(scriptPath); safeUnlink(outputPath);
  }
}


/* ============================
   Shell runner (Unix only)
   ============================ */

async function runShell(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  if (process.platform === 'win32') throw new Error('Shell nodes are not supported on Windows workers — use Powershell or Batch instead');
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_sh_${uid}.sh`);
  const outputPath  = path.join(INBOX, `worker_sh_${uid}.output`);

  const varExports = Object.entries(variables)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([name, val]) => `export ${name}=${JSON.stringify(String(val))}`)
    .join('\n');

  const wrapped = `#!/usr/bin/env bash\nset -e\n${varExports}\nexport INPUT=${JSON.stringify(String(input ?? ''))}\nexport OUTPUT=${JSON.stringify(outputPath)}\n${code}\n`;
  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try { fs.chmodSync(scriptPath, '755'); } catch {}

  try {
    const { exitCode, stdout, stderr } = await runProcess('bash', [scriptPath], { timeoutMs, onLog });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);
    let output: any = null;
    if (fs.existsSync(outputPath)) {
      output = fs.readFileSync(outputPath, 'utf8').trim();
    } else if (stdout) {
      output = stdout.trim();
    }
    if (typeof output === 'string') { try { output = JSON.parse(output); } catch {} }
    return { output: normalizeOutput(output), variables: {} };
  } finally {
    safeUnlink(scriptPath); safeUnlink(outputPath);
  }
}

/* ============================
   Public entry
   ============================ */

export async function executeNode(node: any, onLog?: LogStreamFn): Promise<NodeResult> {
  const type: string = node?.type || node?.data?.type;
  const data = node?.data || {};
  const code: string = data.code || '';
  const input: any = data.input ?? null;
  const variables: Record<string, any> = data.variables || {};
  const timeoutMs: number = data.timeout ? parseInt(data.timeout) * 1000 : 0;

  switch (type) {
    case 'jsbackend':
    case 'javascript':
      return runJsBackend(code, input, variables, timeoutMs, onLog);
    case 'python':
      return runPython(code, input, variables, timeoutMs, onLog);
    case 'groovy':
      return runGroovy(code, input, variables, timeoutMs, onLog);
    case 'powershell':
      return runPowershell(code, input, variables, timeoutMs, onLog);
    case 'batch':
      return runBatch(code, input, variables, timeoutMs, onLog);
    case 'shell':
    case 'bash':
      return runShell(code, input, variables, timeoutMs, onLog);
    case 'variable':
      return { output: variables[data.variableName] ?? input, variables };
    case 'comment':
    case 'goto':
      return { output: input, variables };
    default:
      throw new Error(`Unsupported node type on ${process.platform} worker: ${type}`);
  }
}
