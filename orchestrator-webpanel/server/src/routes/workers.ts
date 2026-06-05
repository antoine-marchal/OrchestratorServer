import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../services/db/index';
import { authMiddleware } from '../middleware/auth';
import { emitJobLog, jobs } from '../services/executor/nodeExecutor';
import { extractSecretNames, resolveSecretValues } from './secrets';
import { putArtifacts, getArtifactBase64 } from '../services/executor/artifactStore';

const router = Router();

// Worker counts as online if its last heartbeat/poll is within this window.
// Single source of truth — flowExecutor imports this for its pre-dispatch
// liveness check so the UI's "online" badge and dispatch eligibility agree.
// Override via WORKER_ONLINE_THRESHOLD_MS.
export const ONLINE_THRESHOLD_MS = parseInt(process.env.WORKER_ONLINE_THRESHOLD_MS || '30000');

// Hard timeout for a single worker job dispatch (rejects the awaiter if the
// worker never reports a result). Expressed in minutes; override via
// DISPATCH_TIMEOUT_MIN.
export const DISPATCH_TIMEOUT_MS = parseInt(process.env.DISPATCH_TIMEOUT_MIN || '5', 10) * 60 * 1000;

export function isWorkerOnline(lastSeenAt: string | undefined): boolean {
  return !!lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

function isOnline(lastSeenAt: string): boolean {
  return isWorkerOnline(lastSeenAt);
}

// Per-worker bearer token middleware. /register is the only worker endpoint
// without it. We hash the token at rest so a DB leak doesn't expose live
// worker credentials; constant-time compare to avoid trivial timing oracles.
function hashWorkerToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function workerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const workerId = req.params.id;
  const auth = req.headers['authorization'];
  if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing worker token' });
    return;
  }
  const raw = auth.slice(7).trim();
  if (!raw) { res.status(401).json({ error: 'Empty worker token' }); return; }
  try {
    const col = getCollection('workers');
    const w = await col.findOne({ _id: workerId });
    if (!w) { res.status(404).json({ error: 'Worker not found' }); return; }
    // Legacy workers registered before per-worker tokens existed have no
    // tokenHash. Accept once so they keep working, then prompt re-register.
    if (!w.tokenHash) {
      console.warn(`[workerAuth] legacy worker "${w.name}" missing tokenHash; allowing once`);
      next();
      return;
    }
    const got = hashWorkerToken(raw);
    const a = Buffer.from(got, 'hex');
    const b = Buffer.from(w.tokenHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Invalid worker token' });
      return;
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// In-memory long-poll waiters per worker. When a new job is dispatched, we
// resolve any parked GET /jobs requests so the worker picks it up immediately
// instead of waiting for the next short-poll tick.
const jobWaiters = new Map<string, Set<() => void>>();
export function notifyWorkerJob(workerId: string): void {
  const set = jobWaiters.get(workerId);
  if (!set) return;
  for (const resolve of [...set]) {
    set.delete(resolve);
    try { resolve(); } catch { /* ignore */ }
  }
  if (!set.size) jobWaiters.delete(workerId);
}

// Workers call this on startup to register. Open endpoint guarded only by
// WORKER_REGISTRATION_SECRET. Returns a fresh per-worker bearer token that
// the worker must send on every subsequent call — this is what /heartbeat,
// /jobs, /log, /complete, etc. authenticate against.
router.post('/register', async (req: Request, res: Response) => {
  const { name, platform = 'unknown', secret, group } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' }) as any;

  const expectedSecret = process.env.WORKER_REGISTRATION_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid registration secret' }) as any;
  }

  const col = getCollection('workers');
  const now = new Date().toISOString();

  // Mint a fresh token on every register call — re-registering a worker
  // (e.g., after restart) rotates its credential automatically.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashWorkerToken(rawToken);

  const existing = await col.findOne({ name });
  if (existing) {
    const updateFields: any = { platform, status: 'online', lastSeenAt: now, tokenHash };
    if (group !== undefined) updateFields.group = group;
    await col.update({ _id: existing._id }, { $set: updateFields });
    return res.json({ workerId: existing._id, token: rawToken, status: 'online' });
  }

  const workerId = uuidv4();
  await col.insert({
    _id: workerId, name, platform, group: group || undefined,
    status: 'online', lastSeenAt: now, registeredAt: now,
    tokenHash,
  });
  res.json({ workerId, token: rawToken, status: 'online' });
});

// Workers heartbeat — keeps status online
router.post('/:id/heartbeat', workerAuth, async (req: Request, res: Response) => {
  const col = getCollection('workers');
  await col.update({ _id: req.params.id }, { $set: { status: 'online', lastSeenAt: new Date().toISOString() } });
  res.json({ ok: true });
});

// Workers long-poll this for pending jobs. The connection is held open until
// either (a) a pending job exists for the worker, or (b) WAIT_MS elapses.
// Cuts average dispatch latency from POLL_INTERVAL_MS (~2s) to single-digit ms
// without burning request count.
const LONG_POLL_WAIT_MS = parseInt(process.env.WORKER_LONG_POLL_MS || '25000');
router.get('/:id/jobs', workerAuth, async (req: Request, res: Response) => {
  const workersCol = getCollection('workers');
  const jobsCol = getCollection('worker_jobs');
  const workerId = req.params.id;
  const worker = await workersCol.findOne({ _id: workerId });
  if (!worker) return res.status(404).json({ error: 'Worker not found' }) as any;
  await workersCol.update({ _id: workerId }, { $set: { status: 'online', lastSeenAt: new Date().toISOString() } });

  const queryJobs = () => jobsCol.find({ workerId, status: 'pending' });

  let jobsList = await queryJobs();
  if (jobsList.length || req.query.wait === '0') {
    res.json({ jobs: jobsList });
    return;
  }

  // Park the connection. Resolves when notifyWorkerJob() fires (new dispatch)
  // or the wait deadline hits. Client-side close is handled too — don't hang
  // request handler memory if the worker walks away.
  await new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const set = jobWaiters.get(workerId);
      if (set) { set.delete(finish); if (!set.size) jobWaiters.delete(workerId); }
      clearTimeout(timer);
      req.removeListener('close', finish);
      resolve();
    };
    const timer = setTimeout(finish, LONG_POLL_WAIT_MS);
    req.on('close', finish);
    if (!jobWaiters.has(workerId)) jobWaiters.set(workerId, new Set());
    jobWaiters.get(workerId)!.add(finish);
  });

  if (res.writableEnded) return;
  jobsList = await queryJobs();
  res.json({ jobs: jobsList });
});

router.post('/:id/jobs/:jobId/ack', workerAuth, async (req: Request, res: Response) => {
  const col = getCollection('worker_jobs');
  await col.update({ _id: req.params.jobId, workerId: req.params.id }, { $set: { status: 'acked', ackedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

router.post('/:id/jobs/:jobId/status', workerAuth, async (req: Request, res: Response) => {
  const col = getCollection('worker_jobs');
  await col.update({ _id: req.params.jobId, workerId: req.params.id }, { $set: { status: 'running', startedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

router.post('/:id/jobs/:jobId/log', workerAuth, async (req: Request, res: Response) => {
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
router.post('/:id/jobs/:jobId/secrets', workerAuth, async (req: Request, res: Response) => {
  try {
    const col = getCollection('worker_jobs');
    const job = await col.findOne({ _id: req.params.jobId, workerId: req.params.id });
    if (!job) return res.status(404).json({ error: 'Job not found' }) as any;
    // Only resolve names that actually appear in this job's code — defence in depth.
    const names = extractSecretNames(job?.node?.data?.code || '');
    const { values, missing } = names.length
      ? await resolveSecretValues(names, { workerId: req.params.id, flowId: job.flowId || null })
      : { values: {}, missing: [] };
    res.json({ values, missing });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Worker fetches one artifact body (base64) referenced by its job. Bodies are
// content-addressed and stored once (artifactStore) instead of inlined per job;
// the worker pulls each on demand right before extraction. Only shas actually
// referenced by THIS job are served — defence in depth.
router.get('/:id/jobs/:jobId/artifacts/:sha', workerAuth, async (req: Request, res: Response) => {
  try {
    const col = getCollection('worker_jobs');
    const job = await col.findOne({ _id: req.params.jobId, workerId: req.params.id });
    if (!job) return res.status(404).json({ error: 'Job not found' }) as any;
    const ref = (job.artifacts || []).find((a: any) => a && a.sha === req.params.sha);
    if (!ref) return res.status(404).json({ error: 'Artifact not referenced by this job' }) as any;
    const data = await getArtifactBase64(req.params.sha);
    if (data == null) return res.status(404).json({ error: 'Artifact blob not found' }) as any;
    res.json({ name: ref.name, sha: ref.sha, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Worker reports job complete. Idempotent: a worker that retries `/complete`
// after the parent execution was already killed (or after a server restart
// that lost the in-memory awaiting promise) still gets a 200 — we always
// persist the outcome on the worker_job record, then best-effort notify.
router.post('/:id/jobs/:jobId/complete', workerAuth, async (req: Request, res: Response) => {
  const { status, output, error, variables } = req.body;
  const col = getCollection('worker_jobs');
  const job = await col.findOne({ _id: req.params.jobId, workerId: req.params.id });
  if (!job) return res.status(404).json({ error: 'Job not found' }) as any;

  // Only persist if we're going from a non-terminal state — protects against
  // a late-arriving `failed` overwriting a `success` already recorded.
  if (!['success', 'failed', 'cancelled'].includes(job.status)) {
    await col.update(
      { _id: req.params.jobId },
      { $set: { status, output, variables, error, completedAt: new Date().toISOString() } },
    );
  }

  // Notify the in-memory awaiter (if any). After a server restart the
  // pendingWorkerJobs entry is gone — that's fine, the executor's catch
  // path (worker_job poller / 5-min timeout) will have already rejected.
  const pending = pendingWorkerJobs.get(req.params.jobId);
  if (pending) {
    pendingWorkerJobs.delete(req.params.jobId);
    try {
      if (status === 'success') pending.resolve({ output, variables: variables || {} });
      else pending.reject(new Error(error || 'Worker job failed'));
    } catch { /* awaiter already settled */ }
  }

  res.json({ ok: true });
});

// Worker deregisters on shutdown
router.delete('/:id', workerAuth, async (req: Request, res: Response) => {
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
  // Artifacts are content-addressed once (see artifactStore) and referenced by
  // sha here — NOT inlined per job. The worker fetches each body on demand from
  // GET /jobs/:jobId/artifacts/:sha, mirroring how it already pulls secrets.
  const artifactRefs = await putArtifacts(artifacts);
  await col.insert({
    _id: jobId, workerId, executionId, nodeId, node,
    artifacts: artifactRefs.length ? artifactRefs : undefined,
    status: 'pending', createdAt: new Date().toISOString(),
  });

  // Wake any worker currently long-polling /jobs so dispatch latency is ~0.
  notifyWorkerJob(workerId);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    // Poll for: parent execution killed, or the hard dispatch timeout.
    const watch = setInterval(() => {
      const parent = jobs.get(executionId);
      const isKilled = !!(parent && parent.stopRequested);
      const isTimedOut = Date.now() - startedAt > DISPATCH_TIMEOUT_MS;
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
