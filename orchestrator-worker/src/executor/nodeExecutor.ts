import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import kill from 'tree-kill';

const WORK_DIR = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
const INBOX = path.join(WORK_DIR, 'inbox');
const GROOVY_JAR = process.env.GROOVY_JAR || path.join(WORK_DIR, 'groovyExec.jar');

if (!fs.existsSync(INBOX)) fs.mkdirSync(INBOX, { recursive: true });

export type LogStreamFn = (type: 'log' | 'error', message: string) => void;
export type NodeResult = { output: any; variables: Record<string, any> };

function nowUid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function safeUnlink(f: string) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { } }

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
    const child = spawn(cmd, args, {
      cwd: opts.cwd || WORK_DIR,
      env: { ...process.env, ...opts.env },
      shell: opts.shell ?? false,
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

    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 0 }); });

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

  const wrapped = `import fs from 'fs';
let output = "";
const input = ${JSON.stringify(input)};
const __variables = ${JSON.stringify(variables)};
${varDecl}
${code}
${varCapture}
fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(output), 'utf8');
`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stderr } = await runProcess(process.execPath, [scriptPath], { timeoutMs, onLog });
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

async function runPlaywright(code: string, input: any, _variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  const uid = nowUid();
  const scriptPath = path.join(os.tmpdir(), `worker_pw_${uid}.js`);
  const wrapped = `const { chromium } = require('playwright');
const __input = ${JSON.stringify(input)};
async function main(input) {
${code}
}
main(__input).then(r => {
  if (r !== undefined) process.stdout.write(JSON.stringify(r));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
`;
  fs.writeFileSync(scriptPath, wrapped);
  try {
    const { exitCode, stdout, stderr } = await runProcess(process.execPath, [scriptPath], { timeoutMs: timeoutMs || 120_000, onLog });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);
    return { output: normalizeOutput(stdout), variables: {} };
  } finally {
    safeUnlink(scriptPath);
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
    case 'playwright':
      return runPlaywright(code, input, variables, timeoutMs, onLog);
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
