import { useEffect, useState, useCallback } from 'react';
import { workersApi } from '../api';

export interface WorkerAccess {
  mode: 'allow' | 'deny';
  roles: string[];
  users: string[];
}

export interface ServerWorker {
  _id: string;
  name: string;
  capabilities: string[];
  status: 'online' | 'offline';
  lastSeenAt: string;
  registeredAt: string;
  assignedUserId?: string;
  group?: string;
  access?: WorkerAccess | null;
}

// Mirror of canUserUseWorker in server/routes/workers.ts. No policy → open.
// Admins always retain access. Used to filter worker pickers so a user never
// sees a worker they couldn't run on anyway.
export function canUseWorker(
  worker: { access?: WorkerAccess | null } | undefined | null,
  role: string,
  login: string,
): boolean {
  const access = worker?.access;
  if (!access || (access.mode !== 'allow' && access.mode !== 'deny')) return true;
  if (role === 'admin') return true;
  const roles = Array.isArray(access.roles) ? access.roles : [];
  const users = Array.isArray(access.users) ? access.users.map(u => String(u).toLowerCase()) : [];
  const matched = roles.includes(role) || users.includes((login || '').toLowerCase());
  return access.mode === 'allow' ? matched : !matched;
}

// UI-relevant fields only. lastSeenAt ticks every heartbeat and would force a
// fresh array reference on every 10s poll, re-rendering everything that
// consumes the worker list (FlowsList rows, worker selects). Ignoring it for
// equality keeps the list stable when nothing visible has actually changed.
const UI_FIELDS: (keyof ServerWorker)[] = ['_id', 'name', 'status', 'group', 'assignedUserId'];
function workersUiEqual(a: ServerWorker[], b: ServerWorker[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    for (const k of UI_FIELDS) {
      if (a[i][k] !== b[i][k]) return false;
    }
  }
  return true;
}

export function useServerWorkers(pollMs = 10_000) {
  const [workers, setWorkers] = useState<ServerWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data: any = await workersApi.list();
      const next: ServerWorker[] = Array.isArray(data) ? data : [];
      setWorkers(prev => (workersUiEqual(prev, next) ? prev : next));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load workers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (pollMs > 0) {
      const t = setInterval(load, pollMs);
      return () => clearInterval(t);
    }
  }, [load, pollMs]);

  return { workers, loading, error, reload: load };
}
