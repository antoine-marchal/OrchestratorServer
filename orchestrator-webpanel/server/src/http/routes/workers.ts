import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { workerJobRepository, workerRepository } from '../../data/repositories';
import { authMiddleware } from '../middleware/auth';
import { emitJobLog } from '../../domain/execution/nodeExecutor';
import { extractSecretNames, resolveSecretValues } from '../../domain/secrets/secretService';
import { getArtifactBase64, getArtifactSize, artifactChunks } from '../../domain/execution/artifactStore';
import type { WorkerAccess } from '../../data/models/Worker';
import {
  hashWorkerToken,
  isWorkerOnline,
  jobWaiters,
  pendingWorkerJobs,
} from '../../domain/workers/workerService';
import { requireRole } from '../middleware/rbac';

const router = Router();

// Coerce a raw access payload into a stored policy, or null to clear it.
function normalizeAccess(raw: any): WorkerAccess | null {
  if (raw == null) return null;
  const mode = raw.mode === 'deny' ? 'deny' : raw.mode === 'allow' ? 'allow' : null;
  if (!mode) return null;
  const roles = Array.isArray(raw.roles) ? raw.roles.filter((r: any) => typeof r === 'string') : [];
  const users = Array.isArray(raw.users)
    ? raw.users.filter((u: any) => typeof u === 'string').map((u: string) => u.toLowerCase())
    : [];
  return { mode, roles, users };
}

// Per-worker bearer token middleware. /register is the only worker endpoint
// without it. The token is hashed at rest (see workerService.hashWorkerToken);
// constant-time compare avoids trivial timing oracles.
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
    const col = workerRepository;
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

  const col = workerRepository;
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
  const col = workerRepository;
  await col.update({ _id: req.params.id }, { $set: { status: 'online', lastSeenAt: new Date().toISOString() } });
  res.json({ ok: true });
});

// Workers long-poll this for pending jobs. The connection is held open until
// either (a) a pending job exists for the worker, or (b) WAIT_MS elapses.
// Cuts average dispatch latency from POLL_INTERVAL_MS (~2s) to single-digit ms
// without burning request count.
const LONG_POLL_WAIT_MS = parseInt(process.env.WORKER_LONG_POLL_MS || '25000');
router.get('/:id/jobs', workerAuth, async (req: Request, res: Response) => {
  const workersCol = workerRepository;
  const jobsCol = workerJobRepository;
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
  const col = workerJobRepository;
  await col.update({ _id: req.params.jobId, workerId: req.params.id }, { $set: { status: 'acked', ackedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

router.post('/:id/jobs/:jobId/status', workerAuth, async (req: Request, res: Response) => {
  const col = workerJobRepository;
  await col.update({ _id: req.params.jobId, workerId: req.params.id }, { $set: { status: 'running', startedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

router.post('/:id/jobs/:jobId/log', workerAuth, async (req: Request, res: Response) => {
  const { type, message } = req.body || {};
  if (!message) return res.json({ ok: true }) as any;

  try {
    const col = workerJobRepository;
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
    const col = workerJobRepository;
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
    const col = workerJobRepository;
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

// Streamed raw download of one artifact body. Unlike the JSON endpoint above
// (which reassembles the whole body into a single base64 string), this writes
// the bytes chunk-by-chunk (artifactChunks) so neither side holds the full file
// in memory — the worker pipes it straight to disk. Use for large artifacts.
router.get('/:id/jobs/:jobId/artifacts/:sha/raw', workerAuth, async (req: Request, res: Response) => {
  try {
    const col = workerJobRepository;
    const job = await col.findOne({ _id: req.params.jobId, workerId: req.params.id });
    if (!job) return res.status(404).json({ error: 'Job not found' }) as any;
    const ref = (job.artifacts || []).find((a: any) => a && a.sha === req.params.sha);
    if (!ref) return res.status(404).json({ error: 'Artifact not referenced by this job' }) as any;
    const size = await getArtifactSize(req.params.sha);
    if (size == null) return res.status(404).json({ error: 'Artifact blob not found' }) as any;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('X-Artifact-Name', encodeURIComponent(ref.name));
    for await (const chunk of artifactChunks(req.params.sha)) {
      if (!res.write(chunk)) await new Promise<void>(r => res.once('drain', r)); // honour backpressure
    }
    res.end();
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message }); else res.destroy(err);
  }
});

// Worker reports job complete. Idempotent: a worker that retries `/complete`
// after the parent execution was already killed (or after a server restart
// that lost the in-memory awaiting promise) still gets a 200 — we always
// persist the outcome on the worker_job record, then best-effort notify.
router.post('/:id/jobs/:jobId/complete', workerAuth, async (req: Request, res: Response) => {
  const { status, output, error, variables } = req.body;
  const col = workerJobRepository;
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
  const col = workerRepository;
  await col.update({ _id: req.params.id }, { $set: { status: 'offline' } });
  res.json({ ok: true });
});

// UI — list all workers (JWT auth required)
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
  const col = workerRepository;
  const workers = await col.find({});
  const result = workers.map((w: any) => ({
    ...w,
    status: isWorkerOnline(w.lastSeenAt) ? 'online' : 'offline',
  }));
  res.json(result);
});

// UI — apply an access policy to every worker in a group (admin only). Lets an
// admin manage accessibility for a whole group in one shot. `__ungrouped__`
// targets workers with no group. Body: { access: WorkerAccess | null }.
router.patch('/groups/:group/access', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const col = workerRepository;
    const access = normalizeAccess(req.body.access);
    const targetGroup = req.params.group === '__ungrouped__' ? '' : req.params.group;
    const all = await col.find({});
    const matches = all.filter((w: any) => (w.group || '') === targetGroup);
    for (const w of matches) await col.update({ _id: w._id }, { $set: { access } });
    res.json({ updated: matches.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// UI — update worker group / access policy (JWT auth required; access changes
// are admin-only).
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const col = workerRepository;
    const updates: any = {};
    if (req.body.group !== undefined) updates.group = req.body.group;
    if (req.body.access !== undefined) {
      if ((req as any).user?.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can change worker access' }) as any;
      }
      updates.access = normalizeAccess(req.body.access);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' }) as any;
    await col.update({ _id: req.params.id }, { $set: updates });
    const w = await col.findOne({ _id: req.params.id });
    if (!w) return res.status(404).json({ error: 'Worker not found' }) as any;
    res.json({ ...w, status: isWorkerOnline(w.lastSeenAt) ? 'online' : 'offline' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// UI — get single worker (JWT auth required)
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  const col = workerRepository;
  const w = await col.findOne({ _id: req.params.id });
  if (!w) return res.status(404).json({ error: 'Worker not found' }) as any;
  res.json({ ...w, status: isWorkerOnline(w.lastSeenAt) ? 'online' : 'offline' });
});

// UI — delete worker record (JWT auth required)
router.delete('/:id/record', authMiddleware, async (req: Request, res: Response) => {
  const col = workerRepository;
  await col.remove({ _id: req.params.id });
  res.json({ ok: true });
});

export default router;
