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
    nodes: f.nodes || [],
    edges: f.edges || [],
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
    jobId: e.jobId || '',
    status: e.status as ExecutionStatus,
    triggeredBy: e.triggeredBy || 'manual',
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

  loadAll: () => void;
  createFlow: (data: { name: string; namespace?: string; description?: string; workerId?: string }) => OrchestratorFlow;
  updateFlow: (id: string, data: Partial<OrchestratorFlow>) => void;
  deleteFlow: (id: string) => void;
  syncWorkerFlows: () => Promise<number>;

  executeFlow: (flowId: string, triggeredBy?: 'manual' | 'schedule') => Promise<string>;
  killExecution: (execId: string) => Promise<void>;
  renameExecution: (execId: string, displayName: string) => void;
  clearExecutions: (flowId?: string) => Promise<void>;
  resumePolling: () => void;

  startScheduler: () => void;
  stopScheduler: () => void;
  syncBackendExecutions: (flowId?: string) => Promise<void>;
}

export const useFlowLibraryStore = create<FlowLibraryState>((set, get) => {
  function getFlows() { return get().flows; }
  function getExecs() { return get().executions; }

  function persistFlows(flows: OrchestratorFlow[]) {
    saveJSON(FLOWS_KEY, flows);
    set({ flows });
  }

  function persistExecs(executions: FlowExecution[]) {
    const trimmed = executions.slice(0, MAX_EXECUTIONS);
    saveJSON(EXECS_KEY, trimmed);
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

    loadAll: () => {
      // Show cached data immediately while server request is in flight
      const flows = loadJSON<OrchestratorFlow[]>(FLOWS_KEY, []);
      const executions = loadJSON<FlowExecution[]>(EXECS_KEY, []);
      set({ flows, executions });

      (async () => {
        try {
          const data: any = await apiClient.get('/api/v1/flows');
          persistFlows((data.flows || []).map(mapServerFlow));
        } catch { /* server may not be ready yet */ }
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
      if (!existing) return;
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      persistFlows(getFlows().map(f => f.id === id ? updated : f));

      apiClient.put(`/api/v1/flows/${id}`, {
        name: updated.name, namespace: updated.namespace,
        description: updated.description, nodes: updated.nodes, edges: updated.edges,
        workerId: updated.workerId || '',
      }).catch(console.error);
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

    executeFlow: async (flowId, triggeredBy = 'manual') => {
      const flow = getFlows().find(f => f.id === flowId);
      if (!flow) throw new Error('Flow not found');

      const data: any = await apiClient.post(`/api/v1/flows/${flowId}/execute`, { triggeredBy });
      const executionId: string = data.executionId;

      const exec: FlowExecution = {
        id: executionId,
        flowId,
        flowName: flow.name,
        namespace: flow.namespace,
        workerId: flow.workerId || '',
        workerName: '',
        jobId: '',
        status: 'RUNNING',
        triggeredBy,
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
      const knownIds = new Set(localExecs.map(e => e.id));
      const knownFlowIds = new Set(getFlows().map(f => f.id));

      try {
        const query = flowId ? `?flowId=${encodeURIComponent(flowId)}&limit=100` : '?limit=100';
        const data: any = await apiClient.get(`/api/v1/executions${query}`);
        const backendExecs: any[] = data.executions || [];
        const newExecs: FlowExecution[] = [];

        for (const bExec of backendExecs) {
          const id = bExec._id || bExec.id;
          if (!id || !knownFlowIds.has(bExec.flowId)) continue;

          if (knownIds.has(id)) {
            const patch: Partial<FlowExecution> = {
              displayName: bExec.displayName,
              status: bExec.status,
              endTime: bExec.endTime,
              duration: bExec.duration,
              output: bExec.output,
              error: bExec.error,
              workerId: bExec.workerId || '',
              workerName: bExec.workerName || '',
              nodes: Array.isArray(bExec.nodes) ? bExec.nodes : undefined,
              edges: Array.isArray(bExec.edges) ? bExec.edges : undefined,
            };
            // Only write logs when the remote has them. The list endpoint
            // returns the persisted DB record, whose `logs` field stays `[]`
            // until the run completes — so blindly copying it would erase
            // the live logs that startPoll has already streamed in.
            if (Array.isArray(bExec.logs) && bExec.logs.length > 0) {
              patch.logs = bExec.logs;
            }
            updateExec(id, patch);
            if (bExec.status !== 'RUNNING') stopPoll(id);
          } else {
            newExecs.push(mapServerExec(bExec));
          }
        }

        if (newExecs.length > 0) {
          const merged = [...newExecs, ...getExecs()];
          persistExecs(merged);
          for (const exec of newExecs) {
            const flow = getFlows().find(f => f.id === exec.flowId);
            if (flow && (!flow.lastExecution || new Date(exec.startTime) > new Date(flow.lastExecution.startTime))) {
              updateFlowLastExec(exec.flowId, exec);
            }
            // Newly-discovered execution still in flight (e.g., cron/API
            // trigger fired) — start the log poller so its logs and status
            // stream live into the UI without a refresh.
            if (exec.status === 'RUNNING') startPoll(exec.id);
          }
        }
      } catch (err) {
        console.error('[flowLibraryStore] syncBackendExecutions failed:', err);
      }
    },
  };
});
