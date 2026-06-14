// Centralised worker configuration — every tunable read from the environment in
// one place. Other modules import these constants instead of reading env ad hoc.
import { v4 as uuidv4 } from 'uuid';

export const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3939';
export const WORKER_NAME      = process.env.WORKER_NAME || `worker-${uuidv4().slice(0, 8)}`;
export const WORKER_SECRET    = process.env.WORKER_REGISTRATION_SECRET || '';
export const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '2000');
export const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000');
export const WORK_DIR         = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
export const EXECUTION_DIR    = process.env.ORCHESTRATOR_EXECUTION_DIR || WORK_DIR;
export const KEEP_ARTIFACTS   = process.env.ORCHESTRATOR_KEEP_ARTIFACTS === 'true';
export const IS_PKG           = !!(process as any).pkg;

// A flow runs node-by-node, each node arriving as a separate worker job that
// carries the same artifact set. We extract (download + decompress) the
// artifacts once per flow execution and keep them on disk for the whole run,
// then sweep them shortly after the execution's last node finishes. This delay
// is the grace window after the last in-flight node of an execution before its
// artifacts are deleted (skipped entirely when ORCHESTRATOR_KEEP_ARTIFACTS=true).
export const ARTIFACT_CLEANUP_DELAY_MS = parseInt(process.env.ORCHESTRATOR_ARTIFACT_CLEANUP_DELAY_MS || '30000');

// How the worker picks up jobs:
//   'parallel'   (default) — take jobs as they arrive, even while a node from
//                 another flow is still running on this worker.
//   'sequential' — finish every in-flight job from the current flow before
//                 accepting a job that belongs to a different flow. Jobs from
//                 other flows stay queued (not ack'd) until the worker is idle.
export const EXECUTION_MODE: 'parallel' | 'sequential' =
  (process.env.WORKER_EXECUTION_MODE || 'parallel').toLowerCase() === 'sequential' ? 'sequential' : 'parallel';

// Long-poll request timeout — must exceed the server's WORKER_LONG_POLL_MS
// (default 25s) plus a small margin, otherwise axios cancels before the
// server replies and we spin in a tight error loop.
export const POLL_HTTP_TIMEOUT_MS = parseInt(process.env.WORKER_LONG_POLL_HTTP_TIMEOUT_MS || '35000');

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

export const MAX_HTTP_BYTES = parseByteSize(process.env.WORKER_MAX_HTTP_SIZE, 100 * 1024 * 1024);
