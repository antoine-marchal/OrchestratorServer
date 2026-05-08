import 'dotenv/config';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { executeNode } from './executor/nodeExecutor';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3939';
const WORKER_NAME = process.env.WORKER_NAME ||  `worker-${uuidv4().slice(0, 8)}`;
const WORKER_SECRET = process.env.WORKER_REGISTRATION_SECRET || 'd76b405918604bc577b946e9b9ab1f0207c0a3f16380706bb9f5caedc5734f68';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '2000');
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000');

const http: AxiosInstance = axios.create({
  baseURL: ORCHESTRATOR_URL,
  timeout: 15000,
});

async function register(): Promise<string> {
  const res = await http.post('/api/v1/workers/register', {
    name: WORKER_NAME,
    secret: WORKER_SECRET,
    capabilities: [
      'javascript', 'jsbackend', 'python', 'groovy',
      'batch', 'powershell', 'playwright',
    ],
  });
  return res.data.workerId;
}

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
    // Fire-and-forget; we don't want a slow log POST to block stdout draining.
    http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/log`, { type, message }).catch(() => {});
  };
  try {
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/status`, { status: 'running' });
    onLog('log', `[worker] running ${job.node?.type ?? 'node'} on "${WORKER_NAME}" (cwd=${process.env.ORCHESTRATOR_WORK_DIR || process.cwd()})`);
    const result = await executeNode(job.node, onLog);
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/complete`, {
      output: result.output,
      variables: result.variables,
      status: 'success',
    });
    console.log(`[worker] Job ${jobId} completed successfully`);
  } catch (err: any) {
    onLog('error', `[worker] ${err.message}`);
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/complete`, {
      status: 'failed',
      error: err.message,
    }).catch(() => {});
    console.error(`[worker] Job ${jobId} failed:`, err.message);
  }
}

async function main(): Promise<void> {
  console.log(`[worker] Starting "${WORKER_NAME}", connecting to ${ORCHESTRATOR_URL}`);

  let workerId: string = '';
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

  // Poll for jobs
  console.log(`[worker] Polling every ${POLL_INTERVAL_MS}ms`);
  setInterval(() => poll(workerId), POLL_INTERVAL_MS);

  // Heartbeat (separate from poll so it keeps the worker online even if idle)
  setInterval(async () => {
    try {
      await http.post(`/api/v1/workers/${workerId}/heartbeat`);
    } catch { }
  }, HEARTBEAT_INTERVAL_MS);

  // Deregister on shutdown
  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    try { await http.delete(`/api/v1/workers/${workerId}`); } catch { }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
