import 'dotenv/config';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { executeNode } from './executor/nodeExecutor';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3939';
const WORKER_NAME      = process.env.WORKER_NAME || `worker-${uuidv4().slice(0, 8)}`;
const WORKER_SECRET    = process.env.WORKER_REGISTRATION_SECRET || '';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '2000');
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000');
const WORK_DIR         = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
const EXECUTION_DIR    = process.env.ORCHESTRATOR_EXECUTION_DIR || WORK_DIR;
const KEEP_ARTIFACTS   = process.env.ORCHESTRATOR_KEEP_ARTIFACTS === 'true';

// How the worker picks up jobs:
//   'parallel'   (default) — take jobs as they arrive, even while a node from
//                 another flow is still running on this worker.
//   'sequential' — finish every in-flight job from the current flow before
//                 accepting a job that belongs to a different flow. Jobs from
//                 other flows stay queued (not ack'd) until the worker is idle.
const EXECUTION_MODE: 'parallel' | 'sequential' =
  (process.env.WORKER_EXECUTION_MODE || 'parallel').toLowerCase() === 'sequential' ? 'sequential' : 'parallel';

/* ─── pkg asset extraction ──────────────────────────────────────────────── */

const IS_PKG = !!(process as any).pkg;

function extractGroovyJar(): void {
  const dest = path.join(WORK_DIR, 'groovyExec.jar');
  if (fs.existsSync(dest)) return;
  if (!IS_PKG) return;
  try {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    // Inside a pkg binary __dirname is the snapshot path where the asset lives
    const src = path.join(__dirname, 'groovyExec.jar');
    fs.copyFileSync(src, dest);
    console.log(`[worker] Extracted groovyExec.jar → ${dest}`);
  } catch (e: any) {
    console.warn(`[worker] Could not extract groovyExec.jar: ${e.message}`);
  }
}

/* ─── HTTP client ───────────────────────────────────────────────────────── */

function parseByteSize(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const m = String(raw).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'b';
  const mult: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  const bytes = Math.floor(n * mult[unit]);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : fallback;
}

const MAX_HTTP_BYTES = parseByteSize(process.env.WORKER_MAX_HTTP_SIZE, 100 * 1024 * 1024);

const http: AxiosInstance = axios.create({
  baseURL: ORCHESTRATOR_URL,
  timeout: 15000,
  maxContentLength: MAX_HTTP_BYTES,
  maxBodyLength: MAX_HTTP_BYTES,
});

/* ─── Registration ──────────────────────────────────────────────────────── */

async function register(): Promise<{ workerId: string; token: string }> {
  const res = await http.post('/api/v1/workers/register', {
    name: WORKER_NAME,
    secret: WORKER_SECRET,
    platform: process.platform,   // 'win32' | 'linux' | 'darwin'
  });
  return { workerId: res.data.workerId, token: res.data.token || '' };
}

// Attach the per-worker token issued at register on every subsequent request.
function setWorkerToken(token: string): void {
  if (token) http.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete http.defaults.headers.common['Authorization'];
}

/* ─── Job polling & execution ───────────────────────────────────────────── */

// Sequential-mode bookkeeping: the flow execution id we're currently bound to
// and how many of its jobs are still running. When the count drops to 0 the
// worker is free to bind to whichever flow's job arrives next.
let activeExecutionId: string | null = null;
let runningJobs = 0;

// Long-poll request timeout — must exceed the server's WORKER_LONG_POLL_MS
// (default 25s) plus a small margin, otherwise axios cancels before the
// server replies and we spin in a tight error loop.
const POLL_HTTP_TIMEOUT_MS = parseInt(process.env.WORKER_LONG_POLL_HTTP_TIMEOUT_MS || '35000');

async function poll(workerId: string): Promise<void> {
  try {
    const res = await http.get(`/api/v1/workers/${workerId}/jobs`, { timeout: POLL_HTTP_TIMEOUT_MS });
    const jobs: any[] = res.data.jobs || [];
    for (const job of jobs) {
      if (
        EXECUTION_MODE === 'sequential' &&
        activeExecutionId !== null &&
        job.executionId !== activeExecutionId
      ) {
        continue; // leave it pending — a later poll picks it up once we're idle
      }
      if (activeExecutionId === null) activeExecutionId = job.executionId ?? null;
      runningJobs++;
      await http.post(`/api/v1/workers/${workerId}/jobs/${job._id}/ack`).catch(() => {});
      executeJob(workerId, job)
        .catch(console.error)
        .finally(() => {
          runningJobs--;
          if (runningJobs === 0) activeExecutionId = null;
        });
    }
  } catch (e: any) {
    if (e.code !== 'ECONNREFUSED' && e.code !== 'ETIMEDOUT') {
      console.error('[worker] poll error:', e.message);
    }
    throw e; // surface to pollLoop so it can back off / re-register
  }
}

/* ─── Secret resolution ─────────────────────────────────────────────────── */

const SECRET_REF_RE = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;

// Resolve `${{ secrets.NAME }}` placeholders in the node's code at execution
// time. The job record only carries the placeholders; we fetch the decrypted
// values from the orchestrator over the worker channel right before running.
async function resolveSecrets(
  workerId: string,
  jobId: string,
  code: string,
  onLog: (type: 'log' | 'error', message: string) => void,
): Promise<string> {
  if (!code || !code.includes('${{')) return code;
  const names = [...new Set([...code.matchAll(SECRET_REF_RE)].map(m => m[1]))];
  if (!names.length) return code;

  let values: Record<string, string> = {};
  try {
    const res = await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/secrets`, { names });
    values = (res.data && res.data.values) || {};
  } catch (e: any) {
    onLog('error', `[secrets] failed to fetch secrets: ${e.message}`);
  }

  const resolved = names.filter(n => n in values);
  const missing = names.filter(n => !(n in values));
  if (resolved.length) onLog('log', `[secrets] resolved: ${resolved.join(', ')}`);
  if (missing.length) onLog('error', `[secrets] no secret found for: ${missing.map(m => `\`${m}\``).join(', ')} — create one in /admin or remove the placeholder`);

  // Missing names become the literal `undefined` so inlined code stays valid.
  return code.replace(SECRET_REF_RE, (_m, name: string) => (name in values ? String(values[name]) : 'undefined'));
}

// Reject absolute paths and any `..` traversal that escapes EXECUTION_DIR.
// Returns null when the artifact name is unsafe; callers should skip it.
function safeArtifactPath(name: string): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) return null;
  const resolvedTarget = path.resolve(EXECUTION_DIR);
  const resolved = path.resolve(resolvedTarget, normalized);
  const rel = path.relative(resolvedTarget, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

// Extensions auto-unpacked at the start of a job — mirrors the server side.
const ARCHIVE_EXTS = ['.zip', '.tar', '.tar.gz', '.tgz', '.gz', '.7z'];
function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return ARCHIVE_EXTS.some(ext => lower.endsWith(ext));
}
function unpackArchive(archivePath: string, targetDir: string): boolean {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('tar', ['-xf', archivePath, '-C', targetDir], { stdio: 'pipe' });
    return true;
  } catch (e: any) {
    if (archivePath.toLowerCase().endsWith('.7z')) {
      for (const bin of ['7z', '7za']) {
        try {
          execFileSync(bin, ['x', '-y', `-o${targetDir}`, archivePath], { stdio: 'pipe' });
          return true;
        } catch { /* try next */ }
      }
    }
    console.warn(`[worker] failed to unpack ${path.basename(archivePath)}: ${e.message}`);
    return false;
  }
}

function extractArtifacts(artifacts: Array<{name: string; data: string}>): void {
  if (!artifacts || !artifacts.length) return;
  if (!fs.existsSync(EXECUTION_DIR)) fs.mkdirSync(EXECUTION_DIR, { recursive: true });
  for (const artifact of artifacts) {
    const destPath = safeArtifactPath(artifact.name);
    if (!destPath) { console.warn(`[worker] rejected unsafe artifact name: ${artifact.name}`); continue; }
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const newData = Buffer.from(artifact.data, 'base64');
    let wrote = true;
    if (fs.existsSync(destPath)) {
      const existing = fs.readFileSync(destPath);
      if (existing.equals(newData)) { wrote = false; }
    }
    if (wrote) {
      fs.writeFileSync(destPath, newData);
      console.log(`[worker] artifact extracted: ${artifact.name}`);
    }
    if (isArchiveName(artifact.name)) {
      const ok = unpackArchive(destPath, EXECUTION_DIR);
      if (ok && !KEEP_ARTIFACTS) {
        try { fs.unlinkSync(destPath); } catch { /* non-fatal */ }
      }
    }
  }
}

function cleanupArtifacts(artifacts: Array<{name: string; data: string}>): void {
  if (!artifacts || !artifacts.length) return;
  for (const artifact of artifacts) {
    const p = safeArtifactPath(artifact.name);
    if (!p) continue;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { }
  }
}

async function executeJob(workerId: string, job: any): Promise<void> {
  const jobId = job._id;
  const artifacts: Array<{name: string; data: string}> = job.artifacts || [];
  const onLog = (type: 'log' | 'error', message: string) => {
    http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/log`, { type, message }).catch(() => {});
  };
  try {
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/status`, { status: 'running' });
    onLog('log', `[worker] running ${job.node?.type ?? 'node'} on "${WORKER_NAME}" (${process.platform}, cwd=${EXECUTION_DIR})`);

    if (artifacts.length) {
      extractArtifacts(artifacts);
      onLog('log', `[worker] ${artifacts.length} artifact(s) extracted to ${EXECUTION_DIR}`);
    }

    if (job.node?.data) {
      job.node.data.code = await resolveSecrets(workerId, jobId, job.node.data.code || '', onLog);
    }
    const result = await executeNode(job.node, onLog);
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/complete`, {
      output: result.output, variables: result.variables, status: 'success',
    });
    console.log(`[worker] Job ${jobId} completed`);

    if (artifacts.length && !KEEP_ARTIFACTS) {
      cleanupArtifacts(artifacts);
    }
  } catch (err: any) {
    onLog('error', `[worker] ${err.message}`);
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/complete`, {
      status: 'failed', error: err.message,
    }).catch(() => {});
    console.error(`[worker] Job ${jobId} failed:`, err.message);

    if (artifacts.length && !KEEP_ARTIFACTS) {
      cleanupArtifacts(artifacts);
    }
  }
}

/* ─── Main ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  extractGroovyJar();
  console.log(`[worker] Starting "${WORKER_NAME}" (${process.platform}), connecting to ${ORCHESTRATOR_URL}`);
  console.log(`[worker] Execution mode: ${EXECUTION_MODE}`);

  let workerId = '';
  const registerAndAuth = async () => {
    const { workerId: id, token } = await register();
    workerId = id;
    setWorkerToken(token);
    return id;
  };
  while (true) {
    try {
      await registerAndAuth();
      console.log(`[worker] Registered as ${workerId}`);
      break;
    } catch (e: any) {
      console.error('[worker] Registration failed, retrying in 5s:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Long-poll loop: re-issue immediately after each poll completes. The
  // server holds the connection open up to ~25s, so this naturally throttles
  // and we don't need POLL_INTERVAL_MS as a wait — only as a back-off after
  // an error/disconnect.
  let pollErrCount = 0;
  const pollLoop = async () => {
    while (true) {
      try {
        await poll(workerId);
        pollErrCount = 0;
      } catch (e: any) {
        pollErrCount++;
        // On 401 the token was invalidated (server restart / re-register
        // elsewhere). Re-register transparently to get a fresh token.
        if (e?.response?.status === 401) {
          try {
            await registerAndAuth();
            pollErrCount = 0;
            continue;
          } catch (re: any) {
            console.error('[worker] Re-registration failed:', re.message);
          }
        }
        const wait = Math.min(POLL_INTERVAL_MS * Math.pow(2, Math.min(pollErrCount, 6)), 60000);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  };
  pollLoop();

  setInterval(async () => {
    try { await http.post(`/api/v1/workers/${workerId}/heartbeat`); } catch {}
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    try { await http.delete(`/api/v1/workers/${workerId}`); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
