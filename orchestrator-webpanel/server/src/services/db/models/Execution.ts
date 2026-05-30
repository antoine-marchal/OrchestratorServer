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
  logs: any[];
  output: any;
  error: string | null;
  displayName?: string;
  nodeStatuses: Record<string, NodeStatus>;
}
