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

async function poll(workerId: string): Promise<void> {
  try {
    const res = await http.get(`/api/v1/workers/${workerId}/jobs`);
    const jobs: any[] = res.data.jobs || [];
    for (const job of jobs) {
      await http.post(`/api/v1/workers/${workerId}/jobs/${job._id}/ack`).catch(() => {});
      executeJob(workerId, job).catch(console.error);
    }
  } catch (e: any) {
    if (e.code !== 'ECONNREFUSED' && e.code !== 'ETIMEDOUT') {
      console.error('[worker] poll error:', e.message);
    }
  }
}

async function executeJob(workerId: string, job: any): Promise<void> {
  const jobId = job._id;
  const onLog = (type: 'log' | 'error', message: string) => {
    http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/log`, { type, message }).catch(() => {});
  };
  try {
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/status`, { status: 'running' });
    onLog('log', `[worker] running ${job.node?.type ?? 'node'} on "${WORKER_NAME}" (${process.platform}, cwd=${WORK_DIR})`);
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
