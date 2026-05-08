import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import kill from 'tree-kill';

/* ============================
   Config & Globals
   ============================ */

const WORK_DIR = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
const INBOX = path.join(WORK_DIR, 'inbox');
const OUTBOX = path.join(WORK_DIR, 'outbox');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 200);
const STOP_CHECK_INTERVAL_MS = Number(process.env.STOP_CHECK_INTERVAL_MS ?? 500);
export const JS_BACKEND_TIMEOUT_MS = Number(process.env.JS_BACKEND_TIMEOUT_MS ?? 0);
export const DEFAULT_FLOW_TIMEOUT_MS = Number(process.env.DEFAULT_FLOW_TIMEOUT_MS ?? 0);

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

function getNodeExecutablePath(): string {
  if (process.env.NODE_EXECUTABLE_PATH) return process.env.NODE_EXECUTABLE_PATH;
  return process.execPath;
}

const nodeExecutablePath = getNodeExecutablePath();

function resolveGroovyJar(): string {
  return path.join(__dirname, '../../..', 'groovyExec.jar');
}

let groovyJarPath = resolveGroovyJar();
// Fall back to backend-level jar
if (!fs.existsSync(groovyJarPath)) {
  groovyJarPath = path.join(process.cwd(), 'groovyExec.jar');
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

function processJsNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, _execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null): void {
  const logs: string[] = [];
  const customConsole = {
    log: (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      logs.push(msg);
      if (jobId) emitJobLog(jobId, 'log', msg, id);
    },
    warn: (...args: any[]) => {
      const msg = '[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      logs.push(msg);
      if (jobId) emitJobLog(jobId, 'log', msg, id);
    },
    error: (...args: any[]) => {
      const msg = '[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      logs.push(msg);
      if (jobId) emitJobLog(jobId, 'error', msg, id);
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

function processGroovyNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null): void {
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

  const child = spawn('java', ['-jar', groovyJarPath, tempGroovyPath, 'lib'], { cwd: execCwd, shell: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, id); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, id); });
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

function processBatchNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null): void {
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
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, id); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, id); });
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

function processJsBackendNode(id: string, code: string, input: any, finish: FinishFn, codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null): void {
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
  const codeWithInput = `let output = "";\nconst input = ${JSON.stringify(input)};\nconst __variables = ${JSON.stringify(variables)};\nimport fs from 'fs';\n${variableDeclarations}\n${code}\n${variableCapture}\nfs.writeFileSync(${JSON.stringify(tempOutputPath)}, JSON.stringify(output), 'utf8');\n`;
  fs.writeFileSync(tempScriptPath, codeWithInput, 'utf8');

  const child = spawn(`"${nodeExecutablePath}"`, [tempScriptPath], { cwd: execCwd, shell: true, timeout: JS_BACKEND_TIMEOUT_MS || undefined });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, id); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, id); });
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

function processPowershellNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null): void {
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
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, id); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, id); });
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

function processPythonNode(id: string, code: string, input: any, finish: FinishFn, _codeFilePath: string | null, execCwd: string, variables: Record<string, any> = {}, jobId: string | null = null): void {
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
  child.stdout.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; if (jobId) emitJobLog(jobId, 'log', t, id); });
  child.stderr.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; if (jobId) emitJobLog(jobId, 'error', t, id); });
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
  const { jobId, type, codeFilePath, input, timeout, dontWaitForOutput } = job;
  job.input = normalizeInput(input);
  job.status = 'running';

  let execCwd = process.cwd();
  try {
    if (job.basePath && fs.existsSync(job.basePath)) execCwd = job.basePath;
    else if (codeFilePath && fs.existsSync(path.dirname(codeFilePath))) execCwd = path.dirname(codeFilePath);
  } catch { }

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
        emitJobLog(jobId, 'log', `[remote] dispatching ${type} node to worker ${job.workerId}`, jobId);
        const { output, variables: workerVars } = await dispatchToWorker(job.workerId, remoteNode, jobId, jobId);
        emitJobLog(jobId, 'log', `[remote] node ${jobId} completed on worker`, jobId);
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
        const result = await executeInlineFlow(tempFlow, job.input, [], job.basePath || process.cwd(), effectiveTimeout || DEFAULT_FLOW_TIMEOUT_MS, ssePath, job.workerId || null, job.parentNodeId || null);
        restore();
        const logMessages = logs.map(l => l.type === 'error' ? `ERROR: ${l.message}` : l.message).join('\n');
        finish({ output: result, log: logMessages || 'Successfully executed flow', error: null });
      } catch (err: any) { restore(); finish({ output: null, log: null, error: `Error executing flow: ${err.message}` }); }
    })();
  } else if (type === 'groovy') {
    processGroovyNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, jobId);
  } else if (type === 'batch') {
    processBatchNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, jobId);
  } else if (type === 'jsbackend' || type === 'playwright') {
    processJsBackendNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, jobId);
  } else if (type === 'powershell') {
    processPowershellNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, jobId);
  } else if (type === 'python') {
    processPythonNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, jobId);
  } else {
    processJsNode(jobId, code, job.input, finish, codeFilePath, execCwd, vars, jobId);
  }
}

export function terminateJobAndChildren(jobId: string): void {
  terminateProcess(jobId);
  const job = jobs.get(jobId);
  if (job) job.stopRequested = true;
}
