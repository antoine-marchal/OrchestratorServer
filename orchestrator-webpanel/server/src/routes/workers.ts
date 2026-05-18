import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../services/db/index';
import { authMiddleware } from '../middleware/auth';
import { emitJobLog, jobs } from '../services/executor/nodeExecutor';
import { extractSecretNames, resolveSecretValues } from './secrets';

const router = Router();

const ONLINE_THRESHOLD_MS = 30_000; // worker is online if seen within 30s

function isOnline(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

// Workers call this on startup to register. Open endpoint — no API key required.
// Optional: set WORKER_REGISTRATION_SECRET env var to restrict who can register.
router.post('/register', async (req: Request, res: Response) => {
  const { name, platform = 'unknown', secret, group } = req.body;
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
    const updateFields: any = { platform, status: 'online', lastSeenAt: now };
    if (group !== undefined) updateFields.group = group;
    await col.update({ _id: existing._id }, { $set: updateFields });
    return res.json({ workerId: existing._id, status: 'online' });
  }

  const workerId = uuidv4();
  await col.insert({
    _id: workerId, name, platform, group: group || undefined,
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

// Worker requests the decrypted secret values referenced by one of its jobs.
// Secrets are NEVER stored in the worker_jobs record — only the `${{ secrets.X }}`
// placeholders inside the node's code. The worker calls this right before it runs
// the node, so plaintext lives only transiently in the worker process (and over
// the already-trusted worker channel), not at rest in the job queue.
router.post('/:id/jobs/:jobId/secrets', async (req: Request, res: Response) => {
  try {
    const col = getCollection('worker_jobs');
    const job = await col.findOne({ _id: req.params.jobId, workerId: req.params.id });
    if (!job) return res.status(404).json({ error: 'Job not found' }) as any;
    // Only resolve names that actually appear in this job's code — defence in depth.
    const names = extractSecretNames(job?.node?.data?.code || '');
    const { values, missing } = names.length ? await resolveSecretValues(names) : { values: {}, missing: [] };
    res.json({ values, missing });
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

// UI — update worker group (JWT auth required)
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const col = getCollection('workers');
    const updates: any = {};
    if (req.body.group !== undefined) updates.group = req.body.group;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' }) as any;
    await col.update({ _id: req.params.id }, { $set: updates });
    const w = await col.findOne({ _id: req.params.id });
    if (!w) return res.status(404).json({ error: 'Worker not found' }) as any;
    res.json({ ...w, status: isOnline(w.lastSeenAt) ? 'online' : 'offline' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
// `artifacts` optionally carries flow-level file attachments to extract on the worker.
export async function dispatchToWorker(workerId: string, node: any, executionId: string, nodeId: string, artifacts?: Array<{name: string; data: string}>): Promise<WorkerJobResult> {
  const col = getCollection('worker_jobs');
  const jobId = uuidv4();
  await col.insert({
    _id: jobId, workerId, executionId, nodeId, node,
    artifacts: artifacts && artifacts.length ? artifacts : undefined,
    status: 'pending', createdAt: new Date().toISOString(),
  });

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    // Poll for: parent execution killed, or the 5-minute hard timeout.
    const watch = setInterval(() => {
      const parent = jobs.get(executionId);
      const isKilled = !!(parent && parent.stopRequested);
      const isTimedOut = Date.now() - startedAt > 5 * 60 * 1000;
      if (!isKilled && !isTimedOut) return;
      clearInterval(watch);
      const pending = pendingWorkerJobs.get(jobId);
      if (!pending) return;
      pendingWorkerJobs.delete(jobId);
      if (isKilled) {
        // Best-effort: flag the worker_job so the worker can skip it if it hasn't started.
        col.update({ _id: jobId }, { $set: { status: 'cancelled' } }).catch(() => {});
        pending.reject(new Error('Execution killed'));
      } else {
        pending.reject(new Error('Worker job timed out'));
      }
    }, 1000);
    const stopWatch = () => clearInterval(watch);
    pendingWorkerJobs.set(jobId, {
      resolve: (v) => { stopWatch(); resolve(v); },
      reject: (e) => { stopWatch(); reject(e); },
    });
  });
}

export default router;
