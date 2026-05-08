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
}

export function useServerWorkers(pollMs = 10_000) {
  const [workers, setWorkers] = useState<ServerWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data: any = await apiClient.get('/api/v1/workers');
      setWorkers(Array.isArray(data) ? data : []);
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
