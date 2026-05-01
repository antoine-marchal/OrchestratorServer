import { create } from 'zustand';
import { pingWorker, invalidateWorkerSession } from '../utils/workerApi';
import type { Worker } from '../utils/workerApi';

const STORAGE_KEY = 'orchestrator-workers';

const WORKER_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
];

export type WorkerStatus = 'connected' | 'disconnected' | 'checking' | 'unknown';

interface WorkerStore {
  workers: Worker[];
  statuses: Record<string, WorkerStatus>;

  loadWorkers: () => void;
  addWorker: (data: Omit<Worker, 'id' | 'color'> & { color?: string }) => Worker;
  updateWorker: (id: string, data: Partial<Omit<Worker, 'id'>>) => void;
  removeWorker: (id: string) => void;
  checkStatus: (id: string) => Promise<void>;
  checkAllStatuses: () => Promise<void>;
  getWorker: (id: string) => Worker | undefined;
  setWorkerStatus: (id: string, status: WorkerStatus) => void;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function save(workers: Worker[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workers));
  } catch { /* storage full */ }
}

function load(): Worker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const useWorkerStore = create<WorkerStore>((set, get) => ({
  workers: [],
  statuses: {},

  loadWorkers: () => {
    const workers = load();
    set({ workers });
  },

  addWorker: (data) => {
    const { workers } = get();
    const color = data.color ?? WORKER_COLORS[workers.length % WORKER_COLORS.length];
    const worker: Worker = { id: uid(), color, ...data };
    const next = [...workers, worker];
    save(next);
    set({ workers: next, statuses: { ...get().statuses, [worker.id]: 'unknown' } });
    // Check status immediately
    get().checkStatus(worker.id);
    return worker;
  },

  updateWorker: (id, data) => {
    const next = get().workers.map(w => w.id === id ? { ...w, ...data } : w);
    save(next);
    set({ workers: next });
    if (data.url || data.apiKey) {
      invalidateWorkerSession(id);
      get().checkStatus(id);
    }
  },

  removeWorker: (id) => {
    invalidateWorkerSession(id);
    const next = get().workers.filter(w => w.id !== id);
    save(next);
    const statuses = { ...get().statuses };
    delete statuses[id];
    set({ workers: next, statuses });
  },

  checkStatus: async (id) => {
    const worker = get().workers.find(w => w.id === id);
    if (!worker) return;
    set(s => ({ statuses: { ...s.statuses, [id]: 'checking' } }));
    const ok = await pingWorker(worker);
    set(s => ({ statuses: { ...s.statuses, [id]: ok ? 'connected' : 'disconnected' } }));
  },

  checkAllStatuses: async () => {
    const { workers } = get();
    await Promise.all(workers.map(w => get().checkStatus(w.id)));
  },

  getWorker: (id) => get().workers.find(w => w.id === id),

  setWorkerStatus: (id, status) => {
    set(s => ({ statuses: { ...s.statuses, [id]: status } }));
  },
}));
