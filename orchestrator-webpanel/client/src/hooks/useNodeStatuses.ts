import { useEffect, useState } from 'react';
import { apiClient, getJwt } from '../utils/apiClient';
import { scopeKey } from '../utils/execScope';

export type NodeExecStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'retrying';

export interface NodeStatus {
  status: NodeExecStatus;
  attempt?: number;
  parentNodeId?: string | null;
}

/**
 * Live per-node execution status for one execution, fed by the SSE stream
 * (`/api/v1/executions/:id/stream`). Keyed by node *instance* scope so A.F1 and
 * B.F1 don't overwrite each other (top-level nodes have no parentScope → key is
 * just the id).
 *
 * This intentionally lives in the parent of the execution panels rather than
 * inside ExecutionGraph: the graph panel can be toggled off, but the timeline
 * and node tree still need live statuses. With the subscription owned by the
 * graph, hiding it left those panels with an empty status map — every active
 * node fell back to "running" until the run finished. Owning the stream here
 * keeps all three panels in sync regardless of which are visible.
 */
export function useNodeStatuses(executionId?: string | null, workerBaseUrl?: string): Record<string, NodeStatus> {
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>({});

  useEffect(() => {
    setStatuses({});
    if (!executionId) return;

    const base = workerBaseUrl ?? apiClient.getBaseUrl().replace('/api/v1', '');
    const jwt = getJwt();
    const url = `${base}/api/v1/executions/${executionId}/stream${jwt ? `?token=${encodeURIComponent(jwt)}` : ''}`;

    const es = new EventSource(url);
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.nodeId && data.status) {
          const key = scopeKey(data.parentScope, data.nodeId);
          setStatuses(prev => ({
            ...prev,
            [key]: {
              status: data.status as NodeExecStatus,
              attempt: data.attempt,
              parentNodeId: data.parentNodeId ?? null,
            },
          }));
        }
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => { es.close(); };

    return () => { es.close(); };
  }, [executionId, workerBaseUrl]);

  return statuses;
}
