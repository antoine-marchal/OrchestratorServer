// Worker domain logic: access policy, liveness, per-worker token hashing, the
// in-memory long-poll/dispatch coordination, and node→worker dispatch. Shared
// by the HTTP layer (routes/workers.ts) and the flow executor. Framework-free.
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { workerJobRepository } from '../../data/repositories';
import { jobs } from '../execution/nodeExecutor';
import { putArtifacts } from '../execution/artifactStore';
import type { WorkerAccess } from '../../data/models/Worker';

// Whether `user` may select & execute on `worker` given its accessibility
// policy. No policy → open to everyone. Admins always retain access. Single
// source of truth shared by the flow execute gate and the worker list.
export function canUserUseWorker(user: { role?: string; login?: string } | null | undefined, worker: any): boolean {
  const access: WorkerAccess | null | undefined = worker?.access;
  if (!access || (access.mode !== 'allow' && access.mode !== 'deny')) return true;
  const role = user?.role || '';
  if (role === 'admin') return true;
  const login = (user?.login || '').toLowerCase();
  const roles = Array.isArray(access.roles) ? access.roles : [];
  const users = Array.isArray(access.users) ? access.users.map(u => String(u).toLowerCase()) : [];
  const matched = roles.includes(role) || users.includes(login);
  return access.mode === 'allow' ? matched : !matched;
}

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

// Hash the per-worker bearer token at rest so a DB leak doesn't expose live
// worker credentials.
export function hashWorkerToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// In-memory long-poll waiters per worker. When a new job is dispatched, we
// resolve any parked GET /jobs requests so the worker picks it up immediately
// instead of waiting for the next short-poll tick.
export const jobWaiters = new Map<string, Set<() => void>>();
export function notifyWorkerJob(workerId: string): void {
  const set = jobWaiters.get(workerId);
  if (!set) return;
  for (const resolve of [...set]) {
    set.delete(resolve);
    try { resolve(); } catch { /* ignore */ }
  }
  if (!set.size) jobWaiters.delete(workerId);
}

// In-memory map: jobId -> { resolve, reject } for local awaiting of worker job completion
export interface WorkerJobResult { output: any; variables: Record<string, any>; }
export const pendingWorkerJobs = new Map<string, { resolve: (v: WorkerJobResult) => void; reject: (e: Error) => void }>();

// Dispatch a node to a specific worker.
// `executionId` is the parent flow's job/execution id (used for log routing).
// `nodeId` is the original node id in the flow graph (attached to log entries).
// `artifacts` optionally carries flow-level file attachments to extract on the worker.
export async function dispatchToWorker(workerId: string, node: any, executionId: string, nodeId: string, artifacts?: Array<{name: string; data: string}>): Promise<WorkerJobResult> {
  const col = workerJobRepository;
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
