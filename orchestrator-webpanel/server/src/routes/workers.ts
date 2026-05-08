import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../services/db/index';
import { authMiddleware } from '../middleware/auth';
import { emitJobLog } from '../services/executor/nodeExecutor';

const router = Router();

const ONLINE_THRESHOLD_MS = 30_000; // worker is online if seen within 30s

function isOnline(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

// Workers call this on startup to register. Open endpoint — no API key required.
// Optional: set WORKER_REGISTRATION_SECRET env var to restrict who can register.
router.post('/register', async (req: Request, res: Response) => {
  const { name, capabilities = [], secret } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' }) as any;

  const expectedSecret = process.env.WORKER_REGISTRATION_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid registration secret' }) as any;
  }

  const col = getCollection('workers');
  const now = new Date().toISOString();

  // Reuse record if worker re-registers with same name
  const existing = await col.findOne({ name });
  if (existing) {
    await col.update({ _id: existing._id }, { $set: { capabilities, status: 'online', lastSeenAt: now } });
    return res.json({ workerId: existing._id, status: 'online' });
  }

  const workerId = uuidv4();
  await col.insert({
    _id: workerId, name, capabilities,
    status: 'online', lastSeenAt: now, registeredAt: now,
  });
  res.json({ workerId, status: 'online' });
});

// Workers heartbeat — keeps status online
router.post('/:id/heartbeat', async (req: Request, res: Response) => {
  const col = getCollection('workers');
  await col.update({ _id: req.params.id }, { $set: { status: 'online', lastSeenAt: new Date().toISOString() } });
  res.json({ ok: true });
});

// Workers poll this for pending jobs
router.get('/:id/jobs', async (req: Request, res: Response) => {
  const col = getCollection('workers');
  const worker = await col.findOne({ _id: req.params.id });
  if (!worker) return res.status(404).json({ error: 'Worker not found' }) as any;

  // Update heartbeat on every poll
  await col.update({ _id: req.params.id }, { $set: { status: 'online', lastSeenAt: new Date().toISOString() } });

  const jobsCol = getCollection('worker_jobs');
  const jobs = await jobsCol.find({ workerId: req.params.id, status: 'pending' });
  res.json({ jobs });
});

// Worker acks a job (preventing reassignment)
router.post('/:id/jobs/:jobId/ack', async (req: Request, res: Response) => {
  const col = getCollection('worker_jobs');
  await col.update({ _id: req.params.jobId, workerId: req.params.id }, { $set: { status: 'acked', ackedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

// Worker reports job running
router.post('/:id/jobs/:jobId/status', async (req: Request, res: Response) => {
  const col = getCollection('worker_jobs');
  await col.update({ _id: req.params.jobId, workerId: req.params.id }, { $set: { status: 'running', startedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

// Worker streams a chunk of stdout/stderr for an in-flight job.
// Body: { type: 'log' | 'error', message: string }
router.post('/:id/jobs/:jobId/log', async (req: Request, res: Response) => {
  const { type, message } = req.body || {};
  if (!message) return res.json({ ok: true }) as any;

  try {
    const col = getCollection('worker_jobs');
    const job = await col.findOne({ _id: req.params.jobId, workerId: req.params.id });
    if (!job) return res.status(404).json({ error: 'Job not found' }) as any;

    // Route log to the parent flow's executionId so the SSE listeners and
    // the persisted execution log buffer pick it up.
    emitJobLog(job.executionId, type === 'error' ? 'error' : 'log', String(message), job.nodeId || null);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Worker reports job complete
router.post('/:id/jobs/:jobId/complete', async (req: Request, res: Response) => {
  const { status, output, error, variables } = req.body;
  const col = getCollection('worker_jobs');
  const job = await col.findOne({ _id: req.params.jobId, workerId: req.params.id });
  if (!job) return res.status(404).json({ error: 'Job not found' }) as any;

  await col.update({ _id: req.params.jobId }, { $set: { status, output, variables, error, completedAt: new Date().toISOString() } });

  // Notify any awaiting execution flow (resolve the pending promise via callback)
  const pending = pendingWorkerJobs.get(req.params.jobId);
  if (pending) {
    pendingWorkerJobs.delete(req.params.jobId);
    if (status === 'success') pending.resolve({ output, variables: variables || {} });
    else pending.reject(new Error(error || 'Worker job failed'));
  }

  res.json({ ok: true });
});

// Worker deregisters on shutdown
router.delete('/:id', async (req: Request, res: Response) => {
  const col = getCollection('workers');
  await col.update({ _id: req.params.id }, { $set: { status: 'offline' } });
  res.json({ ok: true });
});

// UI — list all workers (JWT auth required)
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
  const col = getCollection('workers');
  const workers = await col.find({});
  const result = workers.map((w: any) => ({
    ...w,
    status: isOnline(w.lastSeenAt) ? 'online' : 'offline',
  }));
  res.json(result);
});

// UI — get single worker (JWT auth required)
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  const col = getCollection('workers');
  const w = await col.findOne({ _id: req.params.id });
  if (!w) return res.status(404).json({ error: 'Worker not found' }) as any;
  res.json({ ...w, status: isOnline(w.lastSeenAt) ? 'online' : 'offline' });
});

// UI — delete worker record (JWT auth required)
router.delete('/:id/record', authMiddleware, async (req: Request, res: Response) => {
  const col = getCollection('workers');
  await col.remove({ _id: req.params.id });
  res.json({ ok: true });
});

// In-memory map: jobId -> { resolve, reject } for local awaiting of worker job completion
export interface WorkerJobResult { output: any; variables: Record<string, any>; }
export const pendingWorkerJobs = new Map<string, { resolve: (v: WorkerJobResult) => void; reject: (e: Error) => void }>();

// Called by flowExecutor to dispatch a node to a specific worker.
// `executionId` is the parent flow's job/execution id (used for log routing).
// `nodeId` is the original node id in the flow graph (attached to log entries).
export async function dispatchToWorker(workerId: string, node: any, executionId: string, nodeId: string): Promise<WorkerJobResult> {
  const col = getCollection('worker_jobs');
  const jobId = uuidv4();
  await col.insert({
    _id: jobId, workerId, executionId, nodeId, node,
    status: 'pending', createdAt: new Date().toISOString(),
  });

  return new Promise((resolve, reject) => {
    pendingWorkerJobs.set(jobId, { resolve, reject });
    // Timeout after 5 minutes
    setTimeout(() => {
      if (pendingWorkerJobs.has(jobId)) {
        pendingWorkerJobs.delete(jobId);
        reject(new Error('Worker job timed out'));
      }
    }, 5 * 60 * 1000);
  });
}

export default router;
