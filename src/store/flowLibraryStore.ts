import { create } from 'zustand';
import {
  upsertFlowOnWorker,
  deleteFlowFromWorker,
  fetchWorkerFlows,
  setFlowScheduleOnWorker,
  triggerFlowExecution,
  getFlowExecution,
  killFlowExecution,
  renameFlowExecution,
  fetchWorkerExecutions,
  clearWorkerExecutions,
} from '../utils/workerApi';
import type { OrchestratorFlow, FlowExecution, ExecutionStatus } from '../utils/workerApi';
import { useWorkerStore } from './workerStore';

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

// Active execution polls: executionId → timer
const polls = new Map<string, ReturnType<typeof setTimeout>>();
const renameTimers = new Map<string, ReturnType<typeof setTimeout>>();

function stopPoll(execId: string) {
  const t = polls.get(execId);
  if (t !== undefined) { clearTimeout(t); polls.delete(execId); }
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

interface FlowLibraryState {
  flows: OrchestratorFlow[];
  executions: FlowExecution[];
  schedulerActive: boolean;

  loadAll: () => void;
  createFlow: (data: { name: string; namespace?: string; description?: string; workerId: string }) => OrchestratorFlow;
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

      const worker = useWorkerStore.getState().getWorker(exec.workerId);
      if (!worker) {
        updateExec(execId, { status: 'FAILED', error: 'Worker not found', endTime: new Date().toISOString() });
        stopPoll(execId);
        return;
      }

      try {
        const remoteExec = await getFlowExecution(worker, execId);
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
      const flows = loadJSON<OrchestratorFlow[]>(FLOWS_KEY, []);
      const executions = loadJSON<FlowExecution[]>(EXECS_KEY, []);
      set({ flows, executions });
    },

    createFlow: (data) => {
      const now = new Date().toISOString();
      const flow: OrchestratorFlow = {
        id: uid(),
        name: data.name,
        namespace: data.namespace ?? 'default',
        description: data.description ?? '',
        workerId: data.workerId,
        nodes: [],
        edges: [],
        schedule: null,
        createdAt: now,
        updatedAt: now,
        lastExecution: null,
      };
      persistFlows([flow, ...getFlows()]);

      const worker = useWorkerStore.getState().getWorker(flow.workerId);
      if (worker) upsertFlowOnWorker(worker, flow).catch(console.error);

      return flow;
    },

    updateFlow: (id, data) => {
      const existing = getFlows().find(f => f.id === id);
      if (!existing) return;
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      persistFlows(getFlows().map(f => f.id === id ? updated : f));

      if (data.workerId && data.workerId !== existing.workerId) {
        const previousWorker = useWorkerStore.getState().getWorker(existing.workerId);
        if (previousWorker) deleteFlowFromWorker(previousWorker, id).catch(console.error);
      }

      const worker = useWorkerStore.getState().getWorker(updated.workerId);
      if (worker) {
        upsertFlowOnWorker(worker, updated).catch(console.error);
        if ('schedule' in data) {
          setFlowScheduleOnWorker(worker, id, updated.schedule).catch(console.error);
        }
      }
    },

    deleteFlow: (id) => {
      const flow = getFlows().find(f => f.id === id);
      persistFlows(getFlows().filter(f => f.id !== id));
      getExecs().filter(e => e.flowId === id && e.status === 'RUNNING').forEach(e => stopPoll(e.id));

      if (flow) {
        const worker = useWorkerStore.getState().getWorker(flow.workerId);
        if (worker) deleteFlowFromWorker(worker, id).catch(console.error);
      }
    },

    syncWorkerFlows: async () => {
      const { workers, statuses, setWorkerStatus } = useWorkerStore.getState();
      const knownIds = new Set(getFlows().map(f => f.id));
      const imported: OrchestratorFlow[] = [];

      for (const worker of workers) {
        if (statuses[worker.id] === 'disconnected') continue;

        try {
          const workerFlows = await fetchWorkerFlows(worker);
          for (const flow of workerFlows) {
            if (knownIds.has(flow.id)) continue;
            knownIds.add(flow.id);
            imported.push({
              ...flow,
              workerId: worker.id,
              createdAt: flow.createdAt || new Date().toISOString(),
              updatedAt: flow.updatedAt || new Date().toISOString(),
            });
          }
          setWorkerStatus(worker.id, 'connected');
        } catch {
          setWorkerStatus(worker.id, 'disconnected');
        }
      }

      if (imported.length > 0) {
        persistFlows([...imported, ...getFlows()]);
      }

      return imported.length;
    },

    executeFlow: async (flowId, triggeredBy = 'manual') => {
      const flow = getFlows().find(f => f.id === flowId);
      if (!flow) throw new Error('Flow not found');

      const worker = useWorkerStore.getState().getWorker(flow.workerId);
      if (!worker) throw new Error(`Worker not found for flow "${flow.name}"`);

      await upsertFlowOnWorker(worker, flow);

      const startTime = new Date().toISOString();
      const { executionId } = await triggerFlowExecution(worker, flowId);

      const exec: FlowExecution = {
        id: executionId,
        flowId,
        flowName: flow.name,
        namespace: flow.namespace,
        workerId: worker.id,
        workerName: worker.name,
        jobId: '',
        status: 'RUNNING',
        triggeredBy,
        startTime,
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

      const worker = useWorkerStore.getState().getWorker(exec.workerId);
      if (worker) {
        try { await killFlowExecution(worker, execId); } catch { /* best effort */ }
      }

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

        const worker = useWorkerStore.getState().getWorker(exec.workerId);
        if (!worker) return;

        try {
          const remoteExec = await renameFlowExecution(worker, execId, exec.displayName || '');
          updateExec(execId, { displayName: remoteExec.displayName });
        } catch (err) {
          console.error('Failed to rename execution', err);
        }
      }, 500));
    },

    clearExecutions: async (flowId) => {
      const removed = getExecs().filter(e => !flowId || e.flowId === flowId);
      removed.forEach(e => stopPoll(e.id));

      const { workers, statuses, setWorkerStatus } = useWorkerStore.getState();
      const targetWorkerIds = flowId
        ? new Set(getFlows().filter(f => f.id === flowId).map(f => f.workerId))
        : new Set(workers.map(w => w.id));

      await Promise.allSettled(workers
        .filter(worker => targetWorkerIds.has(worker.id) && statuses[worker.id] !== 'disconnected')
        .map(async worker => {
          try {
            await clearWorkerExecutions(worker, flowId);
          } catch {
            setWorkerStatus(worker.id, 'disconnected');
          }
        }));

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
      const { getWorker } = useWorkerStore.getState();
      for (const flow of getFlows()) {
        const worker = getWorker(flow.workerId);
        if (!worker) continue;
        upsertFlowOnWorker(worker, flow).catch(console.error);
        if (flow.schedule) setFlowScheduleOnWorker(worker, flow.id, flow.schedule).catch(console.error);
      }
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
      const { workers, statuses, setWorkerStatus } = useWorkerStore.getState();
      const localExecs = getExecs();
      const knownIds = new Set(localExecs.map(e => e.id));
      const knownFlowIds = new Set(getFlows().map(f => f.id));
      const targetWorkerIds = flowId
        ? new Set(getFlows().filter(f => f.id === flowId).map(f => f.workerId))
        : null;

      const newExecs: FlowExecution[] = [];

      for (const worker of workers) {
        if (targetWorkerIds && !targetWorkerIds.has(worker.id)) continue;
        if (statuses[worker.id] === 'disconnected') continue;

        try {
          const backendExecs = await fetchWorkerExecutions(worker);
          for (const bExec of backendExecs) {
            if (!knownFlowIds.has(bExec.flowId)) continue;
            if (knownIds.has(bExec.id)) {
              updateExec(bExec.id, {
                displayName: bExec.displayName,
                status: bExec.status,
                endTime: bExec.endTime,
                duration: bExec.duration,
                output: bExec.output,
                error: bExec.error,
                logs: bExec.logs || [],
              });
              if (bExec.status !== 'RUNNING') {
                stopPoll(bExec.id);
              }
              continue;
            }
            newExecs.push(bExec);
          }
        } catch {
          setWorkerStatus(worker.id, 'disconnected');
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
        }
      }
    },
  };
});
