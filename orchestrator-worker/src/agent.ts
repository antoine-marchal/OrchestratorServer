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

const http: AxiosInstance = axios.create({
  baseURL: ORCHESTRATOR_URL,
  timeout: 15000,
});

/* ─── Registration ──────────────────────────────────────────────────────── */

async function register(): Promise<string> {
  const res = await http.post('/api/v1/workers/register', {
    name: WORKER_NAME,
    secret: WORKER_SECRET,
    platform: process.platform,   // 'win32' | 'linux' | 'darwin'
  });
  return res.data.workerId;
}

/* ─── Job polling & execution ───────────────────────────────────────────── */

// Sequential-mode bookkeeping: the flow execution id we're currently bound to
// and how many of its jobs are still running. When the count drops to 0 the
// worker is free to bind to whichever flow's job arrives next.
let activeExecutionId: string | null = null;
let runningJobs = 0;

async function poll(workerId: string): Promise<void> {
  try {
    const res = await http.get(`/api/v1/workers/${workerId}/jobs`);
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

async function executeJob(workerId: string, job: any): Promise<void> {
  const jobId = job._id;
  const onLog = (type: 'log' | 'error', message: string) => {
    http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/log`, { type, message }).catch(() => {});
  };
  try {
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/status`, { status: 'running' });
    onLog('log', `[worker] running ${job.node?.type ?? 'node'} on "${WORKER_NAME}" (${process.platform}, cwd=${WORK_DIR})`);
    if (job.node?.data) {
      job.node.data.code = await resolveSecrets(workerId, jobId, job.node.data.code || '', onLog);
    }
    const result = await executeNode(job.node, onLog);
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/complete`, {
      output: result.output, variables: result.variables, status: 'success',
    });
    console.log(`[worker] Job ${jobId} completed`);
  } catch (err: any) {
    onLog('error', `[worker] ${err.message}`);
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/complete`, {
      status: 'failed', error: err.message,
    }).catch(() => {});
    console.error(`[worker] Job ${jobId} failed:`, err.message);
  }
}

/* ─── Main ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  extractGroovyJar();
  console.log(`[worker] Starting "${WORKER_NAME}" (${process.platform}), connecting to ${ORCHESTRATOR_URL}`);
  console.log(`[worker] Execution mode: ${EXECUTION_MODE}`);

  let workerId = '';
  while (true) {
    try {
      workerId = await register();
      console.log(`[worker] Registered as ${workerId}`);
      break;
    } catch (e: any) {
      console.error('[worker] Registration failed, retrying in 5s:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  setInterval(() => poll(workerId), POLL_INTERVAL_MS);

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
