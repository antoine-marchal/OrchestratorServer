import { create } from 'zustand';
import {
  upsertFlowOnWorker,
  deleteFlowFromWorker,
  setFlowScheduleOnWorker,
  triggerFlowExecution,
  getKestrasExecution,
  killKestrasExecution,
  fetchWorkerExecutions,
} from '../utils/kestraApi';
import type { KestrasFlow, KestrasExecution, ExecutionStatus } from '../utils/kestraApi';
import { useWorkerStore } from './workerStore';

export type { KestrasFlow, KestrasExecution };

const FLOWS_KEY = 'orchestrator-kestra-flows';
const EXECS_KEY = 'orchestrator-kestra-executions';
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

function stopPoll(execId: string) {
  const t = polls.get(execId);
  if (t !== undefined) { clearTimeout(t); polls.delete(execId); }
}

// Background scheduler timer (polls backend for new executions)
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

interface KestraState {
  flows: KestrasFlow[];
  executions: KestrasExecution[];
  schedulerActive: boolean;

  loadAll: () => void;
  createFlow: (data: { name: string; namespace?: string; description?: string; workerId: string }) => KestrasFlow;
  updateFlow: (id: string, data: Partial<KestrasFlow>) => void;
  deleteFlow: (id: string) => void;

  executeFlow: (flowId: string, triggeredBy?: 'manual' | 'schedule') => Promise<string>;
  killExecution: (execId: string) => Promise<void>;
  resumePolling: () => void;

  startScheduler: () => void;
  stopScheduler: () => void;
  syncBackendExecutions: () => Promise<void>;
}

export const useKestraStore = create<KestraState>((set, get) => {
  function getFlows() { return get().flows; }
  function getExecs() { return get().executions; }

  function persistFlows(flows: KestrasFlow[]) {
    saveJSON(FLOWS_KEY, flows);
    set({ flows });
  }

  function persistExecs(executions: KestrasExecution[]) {
    const trimmed = executions.slice(0, MAX_EXECUTIONS);
    saveJSON(EXECS_KEY, trimmed);
    set({ executions: trimmed });
  }

  function updateExec(id: string, patch: Partial<KestrasExecution>) {
    const next = getExecs().map(e => e.id === id ? { ...e, ...patch } : e);
    persistExecs(next);
  }

  function updateFlowLastExec(flowId: string, exec: KestrasExecution) {
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
        const kExec = await getKestrasExecution(worker, execId);
        const status: ExecutionStatus =
          kExec.status === 'SUCCESS' ? 'SUCCESS' :
          kExec.status === 'FAILED' ? 'FAILED' :
          kExec.status === 'KILLED' ? 'KILLED' : 'RUNNING';

        const updated: Partial<KestrasExecution> = {
          status,
          endTime: kExec.endTime ?? null,
          duration: kExec.duration ?? null,
          output: kExec.output ?? null,
          error: kExec.error ?? null,
          logs: kExec.logs || [],
        };
        updateExec(execId, updated);

        if (status !== 'RUNNING') {
          updateFlowLastExec(exec.flowId, { ...exec, ...updated } as KestrasExecution);
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
      const flows = loadJSON<KestrasFlow[]>(FLOWS_KEY, []);
      const executions = loadJSON<KestrasExecution[]>(EXECS_KEY, []);
      set({ flows, executions });
    },

    createFlow: (data) => {
      const now = new Date().toISOString();
      const flow: KestrasFlow = {
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

      // Sync to worker (best effort)
      const worker = useWorkerStore.getState().getWorker(flow.workerId);
      if (worker) upsertFlowOnWorker(worker, flow).catch(console.error);

      return flow;
    },

    updateFlow: (id, data) => {
      const existing = getFlows().find(f => f.id === id);
      if (!existing) return;
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      persistFlows(getFlows().map(f => f.id === id ? updated : f));

      const worker = useWorkerStore.getState().getWorker(updated.workerId);
      if (worker) {
        upsertFlowOnWorker(worker, updated).catch(console.error);
        // Sync schedule changes to backend
        if ('schedule' in data) {
          setFlowScheduleOnWorker(worker, id, updated.schedule).catch(console.error);
        }
      }
    },

    deleteFlow: (id) => {
      const flow = getFlows().find(f => f.id === id);
      persistFlows(getFlows().filter(f => f.id !== id));
      // Stop any running polls
      getExecs().filter(e => e.flowId === id && e.status === 'RUNNING').forEach(e => stopPoll(e.id));

      if (flow) {
        const worker = useWorkerStore.getState().getWorker(flow.workerId);
        if (worker) deleteFlowFromWorker(worker, id).catch(console.error);
      }
    },

    executeFlow: async (flowId, triggeredBy = 'manual') => {
      const flow = getFlows().find(f => f.id === flowId);
      if (!flow) throw new Error('Flow not found');

      const worker = useWorkerStore.getState().getWorker(flow.workerId);
      if (!worker) throw new Error(`Worker not found for flow "${flow.name}"`);

      // Ensure flow is synced on backend before executing
      await upsertFlowOnWorker(worker, flow);

      const startTime = new Date().toISOString();
      const { executionId } = await triggerFlowExecution(worker, flowId);

      const exec: KestrasExecution = {
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
        try { await killKestrasExecution(worker, execId); } catch { /* best effort */ }
      }

      const endTime = new Date().toISOString();
      const updated: Partial<KestrasExecution> = {
        status: 'KILLED',
        endTime,
        duration: new Date(endTime).getTime() - new Date(exec.startTime).getTime(),
      };
      updateExec(execId, updated);
      updateFlowLastExec(exec.flowId, { ...exec, ...updated } as KestrasExecution);
      stopPoll(execId);
    },

    resumePolling: () => {
      const running = getExecs().filter(e => e.status === 'RUNNING');
      running.forEach(e => startPoll(e.id));
      // Also pull any backend-triggered executions we may have missed
      get().syncBackendExecutions().catch(console.error);
    },

    startScheduler: () => {
      if (schedulerTimer) return;
      // Sync all flows with schedules to their workers
      const { getWorker } = useWorkerStore.getState();
      for (const flow of getFlows()) {
        const worker = getWorker(flow.workerId);
        if (!worker) continue;
        upsertFlowOnWorker(worker, flow).catch(console.error);
        if (flow.schedule) setFlowScheduleOnWorker(worker, flow.id, flow.schedule).catch(console.error);
      }
      // Poll backend every 30s for scheduler-triggered executions
      schedulerTimer = setInterval(() => {
        get().syncBackendExecutions().catch(console.error);
      }, 30_000);
      set({ schedulerActive: true });
    },

    stopScheduler: () => {
      if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
      set({ schedulerActive: false });
    },

    syncBackendExecutions: async () => {
      const { workers } = useWorkerStore.getState();
      const localExecs = getExecs();
      const knownIds = new Set(localExecs.map(e => e.id));
      const knownFlowIds = new Set(getFlows().map(f => f.id));

      const newExecs: KestrasExecution[] = [];

      for (const worker of workers) {
        try {
          const backendExecs = await fetchWorkerExecutions(worker);
          for (const bExec of backendExecs) {
            if (!knownFlowIds.has(bExec.flowId)) continue;
            if (knownIds.has(bExec.id)) {
              // Update status of known running execs that finished on backend
              const local = localExecs.find(e => e.id === bExec.id);
              if (local?.status === 'RUNNING' && bExec.status !== 'RUNNING') {
                updateExec(bExec.id, {
                  status: bExec.status,
                  endTime: bExec.endTime,
                  duration: bExec.duration,
                  output: bExec.output,
                  error: bExec.error,
                  logs: bExec.logs || [],
                });
                stopPoll(bExec.id);
              }
              continue;
            }
            newExecs.push(bExec);
          }
        } catch { /* worker unreachable */ }
      }

      if (newExecs.length > 0) {
        const merged = [...newExecs, ...getExecs()];
        persistExecs(merged);
        // Update lastExecution on flows for new execs
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
