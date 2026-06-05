export interface FlowArtifact {
  name: string;
  data: string; // base64
}

export interface Flow {
  _id: string;
  name: string;
  namespace: string;
  description: string;
  nodes: any[];
  edges: any[];
  artifacts?: FlowArtifact[];
  schedule?: {
    cron: string;
    enabled: boolean;
    timezone: string;
  } | null;
  // Optional: delegate execution to a connected worker.
  // When absent or null, the orchestrator runs the flow locally.
  workerAssignment?: {
    workerId: string;
    fallbackToLocal: boolean; // default true — run locally if worker is offline
  } | null;
  // Active git branch whose HEAD the executor runs. Defaults to 'main'.
  activeBranch?: string;
  createdAt: string;
  updatedAt: string;
  lastExecution?: {
    id: string;
    status: string;
    startTime: string;
    endTime: string | null;
    duration: number | null;
  } | null;
}
