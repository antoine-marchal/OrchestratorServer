// Flow library types — used by the flow library store, executions UI, and schedule UI.

export type ExecutionStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'KILLED' | 'QUEUED';

export interface OrchestratorFlow {
  id: string;
  name: string;
  namespace: string;
  description: string;
  workerId: string;
  nodes: any[];
  edges: any[];
  schedule: { cron: string; enabled: boolean; timezone: string } | null;
  createdAt: string;
  updatedAt: string;
  lastExecution: {
    id: string;
    status: ExecutionStatus;
    startTime: string;
    endTime: string | null;
    duration: number | null;
  } | null;
}

export interface LogEntry {
  type: 'log' | 'error' | 'output' | 'input' | 'flow';
  message: string;
  timestamp: number;
  nodeId?: string | null;
}

export interface FlowExecution {
  id: string;
  displayName?: string;
  flowId: string;
  flowName: string;
  namespace: string;
  workerId: string;
  workerName: string;
  jobId: string;
  status: ExecutionStatus;
  triggeredBy: 'manual' | 'schedule';
  startTime: string;
  endTime: string | null;
  duration: number | null;
  logs: LogEntry[];
  output: any;
  error: string | null;
  // Snapshot of the flow graph at execution time. Falls back to the flow's
  // current nodes/edges if absent (e.g., older executions created before the
  // server started persisting the snapshot).
  nodes?: any[];
  edges?: any[];
}
