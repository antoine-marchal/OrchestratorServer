import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../utils/apiClient';

export interface ServerWorker {
  _id: string;
  name: string;
  capabilities: string[];
  status: 'online' | 'offline';
  lastSeenAt: string;
  registeredAt: string;
  assignedUserId?: string;
  group?: string;
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
      const data: any = await apiClient.get('/api/v1/workers');
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
