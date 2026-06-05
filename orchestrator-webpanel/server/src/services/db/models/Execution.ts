export type NodeStatusValue = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'retrying';

export interface NodeStatus {
  status: NodeStatusValue;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  attempt: number;
}

export interface Execution {
  _id: string;
  flowId: string;
  flowName: string;
  namespace: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'KILLED';
  triggeredBy: 'manual' | 'cron' | 'event' | 'api' | 'schedule';
  startTime: string;
  endTime: string | null;
  duration: number | null;
  jobId: string | null;
  // Logs live in the `execution_logs` collection (one doc per execution), not
  // inline — kept optional here for the detail endpoint which re-attaches them.
  logs?: any[];
  output: any;
  error: string | null;
  displayName?: string;
  nodeStatuses: Record<string, NodeStatus>;
  // Immutable git commit this run was pinned to. The detail endpoint
  // reconstructs nodes/edges from it instead of the doc embedding the graph.
  // `nodes`/`edges` may still be inlined as a fallback for git-less flows.
  flowCommit?: string | null;
  nodes?: any[];
  edges?: any[];
}
