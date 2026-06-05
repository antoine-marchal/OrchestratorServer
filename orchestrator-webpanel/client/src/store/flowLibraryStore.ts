import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import type { OrchestratorFlow, FlowExecution, ExecutionStatus } from '../types/flows';

export type { OrchestratorFlow, FlowExecution };

const FLOWS_KEY = 'orchestrator-flows';
const EXECS_KEY = 'orchestrator-executions';
const MAX_EXECUTIONS = 500;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJSON(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

const polls = new Map<string, ReturnType<typeof setTimeout>>();
const renameTimers = new Map<string, ReturnType<typeof setTimeout>>();

function stopPoll(execId: string) {
  const t = polls.get(execId);
  if (t !== undefined) { clearTimeout(t); polls.delete(execId); }
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function mapServerFlow(f: any): OrchestratorFlow {
  return {
    id: f._id || f.id,
    name: f.name,
    namespace: f.namespace || 'default',
    description: f.description || '',
    workerId: f.workerId || '',
    owner: f.owner || undefined,
    activeBranch: f.activeBranch || 'main',
    variants: Array.isArray(f.variants) ? f.variants : [],
    nodes: f.nodes || [],
    edges: f.edges || [],
    artifacts: f.artifacts || [],
    schedule: f.schedule || null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    lastExecution: f.lastExecution || null,
  };
}

function mapServerExec(e: any): FlowExecution {
  return {
    id: e._id || e.id,
    displayName: e.displayName,
    flowId: e.flowId,
    flowName: e.flowName || '',
    namespace: e.namespace || 'default',
    workerId: e.workerId || '',
    workerName: e.workerName || '',
    branch: e.branch || undefined,
    jobId: e.jobId || '',
    status: e.status as ExecutionStatus,
    triggeredBy: e.triggeredBy || 'manual',
    triggeredUser: e.triggeredUser || undefined,
    startTime: e.startTime,
    endTime: e.endTime ?? null,
    duration: e.duration ?? null,
    logs: e.logs || [],
    output: e.output ?? null,
    error: e.error ?? null,
    nodes: Array.isArray(e.nodes) ? e.nodes : undefined,
    edges: Array.isArray(e.edges) ? e.edges : undefined,
  };
}

interface FlowLibraryState {
  flows: OrchestratorFlow[];
  executions: FlowExecution[];
  schedulerActive: boolean;
  // False until the first /api/v1/flows fetch settles (success or failure).
  // The FlowsList uses this to show a loading state instead of the "no flows
  // yet" empty state while the initial request is still in flight.
  loaded: boolean;

  loadAll: () => void;
  createFlow: (data: { name: string; namespace?: string; description?: string; workerId?: string }) => OrchestratorFlow;
  updateFlow: (id: string, data: Partial<OrchestratorFlow>) => Promise<void>;
  deleteFlow: (id: string) => void;
  syncWorkerFlows: () => Promise<number>;

  executeFlow: (flowId: string, triggeredBy?: 'manual' | 'schedule', overrides?: { workerId?: string | null; branch?: string }) => Promise<string>;
  killExecution: (execId: string) => Promise<void>;
  renameExecution: (execId: string, displayName: string) => void;
  clearExecutions: (flowId?: string) => Promise<void>;
  deleteExecution: (execId: string) => Promise<void>;
  resumePolling: () => void;

  startScheduler: () => void;
  stopScheduler: () => void;
  syncBackendExecutions: (flowId?: string) => Promise<void>;
  fetchExecutionDetail: (execId: string) => Promise<void>;
}

export const useFlowLibraryStore = create<FlowLibraryState>((set, get) => {
  function getFlows() { return get().flows; }
  function getExecs() { return get().executions; }

  function persistFlows(flows: OrchestratorFlow[]) {
    saveJSON(FLOWS_KEY, flows);
    // Avoid pushing a new array reference downstream when nothing actually
    // changed — the FlowsList polls every 5s and a fresh reference every
    // tick used to make the entire table flash. Reuse existing flow objects
    // by identity when their serialized shape is unchanged.
    const current = get().flows;
    if (current.length === flows.length) {
      let allSame = true;
      const merged: OrchestratorFlow[] = [];
      for (let i = 0; i < flows.length; i++) {
        const next = flows[i];
        const prev = current[i];
        if (prev && prev.id === next.id && JSON.stringify(prev) === JSON.stringify(next)) {
          merged.push(prev);
        } else {
          merged.push(next);
          allSame = false;
        }
      }
      if (allSame) return;
      set({ flows: merged });
      return;
    }
    set({ flows });
  }

  function persistExecs(executions: FlowExecution[]) {
    const trimmed = executions.slice(0, MAX_EXECUTIONS);
    saveJSON(EXECS_KEY, trimmed);
    // Same reference-stability trick as persistFlows: skip the set when the
    // payload is structurally identical, otherwise reuse existing exec
    // objects element-by-element to prevent the executions list from
    // flashing on every poll.
    const current = get().executions;
    if (current.length === trimmed.length) {
      let allSame = true;
      const merged: FlowExecution[] = [];
      for (let i = 0; i < trimmed.length; i++) {
        const next = trimmed[i];
        const prev = current[i];
        if (prev && prev.id === next.id && JSON.stringify(prev) === JSON.stringify(next)) {
          merged.push(prev);
        } else {
          merged.push(next);
          allSame = false;
        }
      }
      if (allSame) return;
      set({ executions: merged });
      return;
    }
    set({ executions: trimmed });
  }

  function updateExec(id: string, patch: Partial<FlowExecution>) {
    const next = getExecs().map(e => e.id === id ? { ...e, ...patch } : e);
    persistExecs(next);
  }

  function updateFlowLastExec(flowId: string, exec: FlowExecution) {
    persistFlows(getFlows().map(f =>
      f.id === flowId
        ? { ...f, lastExecution: { id: exec.id, status: exec.status, startTime: exec.startTime, endTime: exec.endTime, duration: exec.duration } }
        : f
    ));
  }

  function startPoll(execId: string) {
    if (polls.has(execId)) return;

    async function tick() {
      const exec = getExecs().find(e => e.id === execId);
      if (!exec || exec.status !== 'RUNNING') { stopPoll(execId); return; }

      try {
        const remoteExec: any = await apiClient.get(`/api/v1/executions/${execId}`);
        const status: ExecutionStatus =
          remoteExec.status === 'SUCCESS' ? 'SUCCESS' :
          remoteExec.status === 'FAILED' ? 'FAILED' :
          remoteExec.status === 'KILLED' ? 'KILLED' : 'RUNNING';

        const updated: Partial<FlowExecution> = {
          status,
          endTime: remoteExec.endTime ?? null,
          duration: remoteExec.duration ?? null,
          output: remoteExec.output ?? null,
          error: remoteExec.error ?? null,
          logs: remoteExec.logs || [],
          nodes: Array.isArray(remoteExec.nodes) ? remoteExec.nodes : undefined,
          edges: Array.isArray(remoteExec.edges) ? remoteExec.edges : undefined,
        };
        updateExec(execId, updated);

        if (status !== 'RUNNING') {
          updateFlowLastExec(exec.flowId, { ...exec, ...updated } as FlowExecution);
          stopPoll(execId);
        } else {
          polls.set(execId, setTimeout(tick, 2000));
        }
      } catch {
        polls.set(execId, setTimeout(tick, 5000));
      }
    }

    polls.set(execId, setTimeout(tick, 1000));
  }

  return {
    flows: [],
    executions: [],
    schedulerActive: false,
    loaded: false,

    loadAll: () => {
      // First call only: hydrate from localStorage so the UI has something to
      // render before the network request comes back. Subsequent calls (the
      // FlowsList polls this every 5s) skip the hydrate — replaying it on
      // every tick was clobbering the live in-memory refs with fresh ones
      // from JSON.parse and flashing the table.
      if (get().flows.length === 0 && get().executions.length === 0) {
        const flows = loadJSON<OrchestratorFlow[]>(FLOWS_KEY, []);
        const executions = loadJSON<FlowExecution[]>(EXECS_KEY, []);
        if (flows.length || executions.length) set({ flows, executions });
      }

      (async () => {
        try {
          const data: any = await apiClient.get('/api/v1/flows');
          const serverFlows: OrchestratorFlow[] = (data.flows || []).map(mapServerFlow);
          // Preserve in-flight optimistic edits. When the local copy's
          // updatedAt is newer than the server's, the PUT just hasn't landed
          // yet — keep the local copy to avoid flashing owner/namespace
          // back to the server's stale value for a poll tick.
          const localById = new Map(get().flows.map(f => [f.id, f]));
          const merged = serverFlows.map(sf => {
            const local = localById.get(sf.id);
            if (local && local.updatedAt && sf.updatedAt && new Date(local.updatedAt).getTime() > new Date(sf.updatedAt).getTime()) {
              return local;
            }
            return sf;
          });
          persistFlows(merged);
        } catch { /* server may not be ready yet */ }
        finally { if (!get().loaded) set({ loaded: true }); }
      })();
    },

    createFlow: (data) => {
      const now = new Date().toISOString();
      const flow: OrchestratorFlow = {
        id: uid(),
        name: data.name,
        namespace: data.namespace ?? 'default',
        description: data.description ?? '',
        workerId: data.workerId || '',
        nodes: [],
        edges: [],
        schedule: null,
        createdAt: now,
        updatedAt: now,
        lastExecution: null,
      };
      persistFlows([flow, ...getFlows()]);

      // Upsert on server using the same local id (PUT = upsert)
      apiClient.put(`/api/v1/flows/${flow.id}`, {
        name: flow.name, namespace: flow.namespace,
        description: flow.description, nodes: [], edges: [],
        workerId: flow.workerId || '',
      }).catch(console.error);

      return flow;
    },

    updateFlow: (id, data) => {
      const existing = getFlows().find(f => f.id === id);
      if (!existing) return Promise.resolve();
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      persistFlows(getFlows().map(f => f.id === id ? updated : f));

      // Return the PUT promise so callers that must guarantee the server has
      // the latest definition before acting (e.g. executeFlow) can await it.
      // Most callers fire-and-forget; the .catch keeps those from producing
      // unhandled rejections.
      return apiClient.put(`/api/v1/flows/${id}`, {
        name: updated.name, namespace: updated.namespace,
        description: updated.description, nodes: updated.nodes, edges: updated.edges,
        workerId: updated.workerId || '',
        artifacts: updated.artifacts || [],
        owner: updated.owner,
        variants: updated.variants || [],
      }).then(() => undefined).catch(err => { console.error(err); });
    },

    deleteFlow: (id) => {
      persistFlows(getFlows().filter(f => f.id !== id));
      getExecs().filter(e => e.flowId === id && e.status === 'RUNNING').forEach(e => stopPoll(e.id));
      apiClient.delete(`/api/v1/flows/${id}`).catch(console.error);
    },

    syncWorkerFlows: async () => {
      await get().syncBackendExecutions().catch(() => {});
      return 0;
    },

    executeFlow: async (flowId, triggeredBy = 'manual', overrides) => {
      const flow = getFlows().find(f => f.id === flowId);
      if (!flow) throw new Error('Flow not found');

      const body: any = { triggeredBy };
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, 'workerId')) body.workerId = overrides.workerId || '';
      if (overrides?.branch) body.branch = overrides.branch;
      const data: any = await apiClient.post(`/api/v1/flows/${flowId}/execute`, body);
      const executionId: string = data.executionId;

      const ovWorkerId = overrides && Object.prototype.hasOwnProperty.call(overrides, 'workerId') ? (overrides.workerId || '') : (flow.workerId || '');
      const storedUser = (() => { try { return JSON.parse(localStorage.getItem('orchestrator_user') || '{}'); } catch { return {}; } })();
      const exec: FlowExecution = {
        id: executionId,
        flowId,
        flowName: flow.name,
        namespace: flow.namespace,
        workerId: ovWorkerId,
        workerName: '',
        branch: overrides?.branch || flow.activeBranch || 'main',
        jobId: '',
        status: 'RUNNING',
        triggeredBy,
        triggeredUser: storedUser?.login || undefined,
        startTime: new Date().toISOString(),
        endTime: null,
        duration: null,
        logs: [],
        output: null,
        error: null,
      };
      persistExecs([exec, ...getExecs()]);
      updateFlowLastExec(flowId, exec);
      startPoll(executionId);

      return executionId;
    },

    killExecution: async (execId) => {
      const exec = getExecs().find(e => e.id === execId);
      if (!exec || exec.status !== 'RUNNING') return;

      try { await apiClient.post(`/api/v1/executions/${execId}/kill`); } catch { /* best effort */ }

      const endTime = new Date().toISOString();
      const updated: Partial<FlowExecution> = {
        status: 'KILLED',
        endTime,
        duration: new Date(endTime).getTime() - new Date(exec.startTime).getTime(),
      };
      updateExec(execId, updated);
      updateFlowLastExec(exec.flowId, { ...exec, ...updated } as FlowExecution);
      stopPoll(execId);
    },

    renameExecution: (execId, displayName) => {
      const normalized = displayName.trim() || undefined;
      updateExec(execId, { displayName: normalized });

      const existingTimer = renameTimers.get(execId);
      if (existingTimer) clearTimeout(existingTimer);

      renameTimers.set(execId, setTimeout(async () => {
        renameTimers.delete(execId);
        const exec = getExecs().find(e => e.id === execId);
        if (!exec) return;
        try {
          const updated: any = await apiClient.patch(`/api/v1/executions/${execId}`, { displayName: exec.displayName || '' });
          updateExec(execId, { displayName: updated.displayName });
        } catch (err) {
          console.error('Failed to rename execution', err);
        }
      }, 500));
    },

    clearExecutions: async (flowId) => {
      const removed = getExecs().filter(e => !flowId || e.flowId === flowId);
      removed.forEach(e => stopPoll(e.id));

      const url = flowId ? `/api/v1/executions?flowId=${encodeURIComponent(flowId)}` : '/api/v1/executions';
      await apiClient.delete(url).catch(console.error);

      persistExecs(getExecs().filter(e => flowId && e.flowId !== flowId));

      if (flowId) {
        persistFlows(getFlows().map(f => f.id === flowId ? { ...f, lastExecution: null } : f));
      } else {
        persistFlows(getFlows().map(f => ({ ...f, lastExecution: null })));
      }
    },

    deleteExecution: async (execId) => {
      const exec = getExecs().find(e => e.id === execId);
      if (!exec) return;
      // Backend is authoritative: it enforces the role/author rules and may
      // reject with 403 (not your execution) or 409 (still running). Let the
      // error propagate so the caller can surface it; only touch local state
      // once the server confirms the delete.
      await apiClient.delete(`/api/v1/executions/${encodeURIComponent(execId)}`);
      stopPoll(execId);
      const remaining = getExecs().filter(e => e.id !== execId);
      persistExecs(remaining);

      // Repoint the flow's lastExecution if it pointed at the deleted row.
      const flow = getFlows().find(f => f.id === exec.flowId);
      if (flow && flow.lastExecution && flow.lastExecution.id === execId) {
        const latest = remaining
          .filter(e => e.flowId === exec.flowId)
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
        persistFlows(getFlows().map(f => f.id === exec.flowId
          ? { ...f, lastExecution: latest
              ? { id: latest.id, status: latest.status, startTime: latest.startTime, endTime: latest.endTime, duration: latest.duration }
              : null }
          : f));
      }
    },

    resumePolling: () => {
      const running = getExecs().filter(e => e.status === 'RUNNING');
      running.forEach(e => startPoll(e.id));
      get().syncBackendExecutions().catch(console.error);
    },

    startScheduler: () => {
      if (schedulerTimer) return;
      schedulerTimer = setInterval(() => {
        get().syncBackendExecutions().catch(console.error);
      }, 30_000);
      set({ schedulerActive: true });
    },

    stopScheduler: () => {
      if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
      set({ schedulerActive: false });
    },

    syncBackendExecutions: async (flowId) => {
      const localExecs = getExecs();
      const knownById = new Map(localExecs.map(e => [e.id, e]));
      const knownFlowIds = new Set(getFlows().map(f => f.id));

      try {
        const query = flowId ? `?flowId=${encodeURIComponent(flowId)}&limit=100` : '?limit=100';
        const data: any = await apiClient.get(`/api/v1/executions${query}`);
        const backendExecs: any[] = data.executions || [];

        // Build the next executions array in one pass and persist it ONCE.
        // The previous implementation called updateExec per backend row,
        // which fired N persistExecs/set() calls per poll — even when the
        // dedupe inside persistExecs reused most refs, the cascade of N
        // store updates re-rendered the list N times and made it flash.
        const newExecs: FlowExecution[] = [];
        const patchedExecs = new Map<string, FlowExecution>();
        const stoppedRunningIds: string[] = [];

        for (const bExec of backendExecs) {
          const id = bExec._id || bExec.id;
          if (!id || !knownFlowIds.has(bExec.flowId)) continue;

          if (knownById.has(id)) {
            const prev = knownById.get(id)!;
            // The list endpoint is metadata-only — logs/nodes/edges are fetched
            // lazily via fetchExecutionDetail. Only patch them when the row
            // happens to carry them, so we never clobber already-fetched detail.
            const patch: Partial<FlowExecution> = {
              displayName: bExec.displayName,
              status: bExec.status,
              endTime: bExec.endTime,
              duration: bExec.duration,
              output: bExec.output,
              error: bExec.error,
              workerId: bExec.workerId || '',
              workerName: bExec.workerName || '',
              branch: bExec.branch || prev.branch,
            };
            if (Array.isArray(bExec.nodes) && bExec.nodes.length) patch.nodes = bExec.nodes;
            if (Array.isArray(bExec.edges) && bExec.edges.length) patch.edges = bExec.edges;
            if (Array.isArray(bExec.logs) && bExec.logs.length > 0) patch.logs = bExec.logs;
            patchedExecs.set(id, { ...prev, ...patch });
            if (bExec.status !== 'RUNNING') stoppedRunningIds.push(id);
          } else {
            newExecs.push(mapServerExec(bExec));
          }
        }

        // Compose the merged list: newly discovered execs prepended, then
        // every existing exec (patched in place when the server returned
        // an update, otherwise left as-is).
        const merged = [
          ...newExecs,
          ...localExecs.map(e => patchedExecs.get(e.id) ?? e),
        ];
        persistExecs(merged);

        for (const id of stoppedRunningIds) stopPoll(id);

        for (const exec of newExecs) {
          const flow = getFlows().find(f => f.id === exec.flowId);
          if (flow && (!flow.lastExecution || new Date(exec.startTime) > new Date(flow.lastExecution.startTime))) {
            updateFlowLastExec(exec.flowId, exec);
          }
          if (exec.status === 'RUNNING') startPoll(exec.id);
        }
      } catch (err) {
        console.error('[flowLibraryStore] syncBackendExecutions failed:', err);
      }
    },

    // Pull the heavy detail (logs + node/edge graph) for one execution. The list
    // endpoint returns metadata only; this fills in the rest when the user opens
    // an execution. RUNNING execs are kept fresh by startPoll instead.
    fetchExecutionDetail: async (execId) => {
      try {
        const d: any = await apiClient.get(`/api/v1/executions/${execId}`);
        updateExec(execId, {
          logs: d.logs || [],
          nodes: Array.isArray(d.nodes) ? d.nodes : undefined,
          edges: Array.isArray(d.edges) ? d.edges : undefined,
          output: d.output ?? null,
          error: d.error ?? null,
          status: d.status as ExecutionStatus,
          endTime: d.endTime ?? null,
          duration: d.duration ?? null,
        });
      } catch (err) {
        console.error('[flowLibraryStore] fetchExecutionDetail failed:', err);
      }
    },
  };
});
