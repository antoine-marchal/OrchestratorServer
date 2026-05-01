// Per-worker API utilities

export interface Worker {
  id: string;
  name: string;
  url: string;      // e.g. "http://localhost:3000"
  apiKey: string;
  color: string;
}

export type ExecutionStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'KILLED' | 'QUEUED';

export interface OrchestratorFlow {
  id: string;
  name: string;
  namespace: string;
  description: string;
  workerId: string;
  nodes: any[];
  edges: any[];
  schedule: { cron: string; enabled: boolean; timezone: string } | null;
  createdAt: string;
  updatedAt: string;
  lastExecution: {
    id: string;
    status: ExecutionStatus;
    startTime: string;
    endTime: string | null;
    duration: number | null;
  } | null;
}

export interface LogEntry {
  type: 'log' | 'error' | 'output';
  message: string;
  timestamp: number;
  nodeId?: string | null;
}

export interface FlowExecution {
  id: string;
  displayName?: string;
  flowId: string;
  flowName: string;
  namespace: string;
  workerId: string;
  workerName: string;
  jobId: string;
  status: ExecutionStatus;
  triggeredBy: 'manual' | 'schedule';
  startTime: string;
  endTime: string | null;
  duration: number | null;
  logs: LogEntry[];
  output: any;
  error: string | null;
}

export interface JobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  output?: any;
  error?: string;
  executionTime?: number;
  startTime: string;
  endTime?: string;
  streamLogs?: LogEntry[];
  totalLogCount?: number;
}

// --- URL normalization ---

function normalizeWorkerUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
}

// --- Session cache ---

interface CachedSession {
  sessionId: string;
  token: string;
  expiresAt: string;
}

const sessionCache = new Map<string, CachedSession>();

function baseUrl(worker: Worker): string {
  return normalizeWorkerUrl(worker.url) + '/api/v1';
}

async function ensureSession(worker: Worker): Promise<string> {
  const cached = sessionCache.get(worker.id);
  if (cached && new Date(cached.expiresAt).getTime() > Date.now() + 60_000) {
    return cached.token;
  }

  const res = await fetch(`${baseUrl(worker)}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': worker.apiKey },
    body: JSON.stringify({ metadata: { source: 'orchestrator-client' } }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Cannot connect to worker "${worker.name}"`);
  }

  const session: CachedSession = await res.json();
  sessionCache.set(worker.id, session);
  return session.token;
}

async function workerFetch<T>(
  worker: Worker,
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  const token = await ensureSession(worker);
  const res = await fetch(`${baseUrl(worker)}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string>),
    },
    signal: options.signal ?? AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (retry && err.error?.code === 'INVALID_TOKEN') {
      sessionCache.delete(worker.id);
      return workerFetch(worker, path, options, false);
    }
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// Flow library endpoints use X-API-Key directly (no session needed)
async function flowsFetch<T>(
  worker: Worker,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${baseUrl(worker)}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': worker.apiKey,
      ...(options.headers as Record<string, string>),
    },
    signal: options.signal ?? AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// --- Public API ---

export async function pingWorker(worker: Worker): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(worker)}/ping`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function executeFlowOnWorker(
  worker: Worker,
  flowContent: { nodes: any[]; edges: any[] },
  input?: any,
  timeout?: number
): Promise<string> {
  const session = sessionCache.get(worker.id);
  const result = await workerFetch<{ jobId: string }>(worker, '/jobs', {
    method: 'POST',
    body: JSON.stringify({
      type: 'flow',
      code: JSON.stringify(flowContent),
      input: input ?? null,
      timeout: timeout ?? 0,
      sessionId: session?.sessionId,
    }),
  });
  return result.jobId;
}

export async function getWorkerJobStatus(
  worker: Worker,
  jobId: string,
  lastLogIndex = 0
): Promise<JobStatus> {
  return workerFetch<JobStatus>(worker, `/jobs/${jobId}?lastLogIndex=${lastLogIndex}`);
}

export async function stopWorkerJob(worker: Worker, jobId: string): Promise<void> {
  await workerFetch(worker, `/jobs/${jobId}/stop`, { method: 'POST' });
}

export function invalidateWorkerSession(workerId: string): void {
  sessionCache.delete(workerId);
}

// --- Flow library sync ---

export async function upsertFlowOnWorker(worker: Worker, flow: OrchestratorFlow): Promise<void> {
  await flowsFetch(worker, `/flows/${flow.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: flow.name,
      namespace: flow.namespace,
      description: flow.description,
      nodes: flow.nodes,
      edges: flow.edges,
    }),
  });
}

export async function deleteFlowFromWorker(worker: Worker, flowId: string): Promise<void> {
  try {
    await flowsFetch(worker, `/flows/${flowId}`, { method: 'DELETE' });
  } catch { /* best effort */ }
}

export async function setFlowScheduleOnWorker(
  worker: Worker,
  flowId: string,
  schedule: { cron: string; enabled: boolean; timezone: string } | null
): Promise<void> {
  if (schedule) {
    await flowsFetch(worker, `/flows/${flowId}/schedule`, {
      method: 'PUT',
      body: JSON.stringify(schedule),
    });
  } else {
    try {
      await flowsFetch(worker, `/flows/${flowId}/schedule`, { method: 'DELETE' });
    } catch { /* may not exist */ }
  }
}

export async function triggerFlowExecution(
  worker: Worker,
  flowId: string
): Promise<{ executionId: string }> {
  return flowsFetch<{ executionId: string }>(worker, `/flows/${flowId}/execute`, {
    method: 'POST',
  });
}

export async function getFlowExecution(
  worker: Worker,
  executionId: string
): Promise<FlowExecution> {
  return flowsFetch<FlowExecution>(worker, `/executions/${executionId}`);
}

export async function killFlowExecution(worker: Worker, executionId: string): Promise<void> {
  await flowsFetch(worker, `/executions/${executionId}/kill`, { method: 'POST' });
}

export async function renameFlowExecution(
  worker: Worker,
  executionId: string,
  displayName: string
): Promise<FlowExecution> {
  return flowsFetch<FlowExecution>(worker, `/executions/${executionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  });
}

export async function fetchWorkerExecutions(
  worker: Worker,
  since?: string
): Promise<FlowExecution[]> {
  const params = new URLSearchParams({ limit: '100' });
  if (since) params.set('since', since);
  const data = await flowsFetch<{ executions: any[] }>(worker, `/executions?${params}`);
  return (data.executions || []).map((e: any) => ({
    ...e,
    workerId: worker.id,
    workerName: worker.name,
    logs: e.logs || [],
  }));
}

export async function clearWorkerExecutions(worker: Worker, flowId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (flowId) params.set('flowId', flowId);
  const suffix = params.toString() ? `?${params}` : '';
  await flowsFetch(worker, `/executions${suffix}`, { method: 'DELETE' });
}
