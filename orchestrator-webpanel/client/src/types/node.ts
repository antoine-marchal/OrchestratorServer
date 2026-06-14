import { Node, Edge } from 'reactflow';

export interface NodeData {
  label: string;
  type: 'variable' | 'javascript' | 'jsbackend' | 'groovy' | 'batch' | 'powershell' | 'python' | 'shell' | 'flow' | 'comment' | 'goto';
  language?: string;
  code?: string;
  codeFilePath?: string;
  value?: string;
  input?: any;
  output?: any;
  executionTime?: number;
  isRelativePath?: boolean;
  isStarterNode?: boolean;
  jobId?: string;
  // Reference to a library flow this node points at (vs an embedded session/code).
  flowRef?: string;

  //Add Goto-specific fields
  conditions?: Array<{
    expr: string;            // JS expression, e.g. "input.value < 50"
    goto: string | string[]; // nodeId(s) to jump to — single target or an array
    forwardInput?: boolean;
  }>;
  gotoDecision?: string | string[] | null; // transient decision during "run entire flow"
  
  // Linked session for editing flow nodes
  linkedSessionId?: string;
  // Display name of the linked editor session (the tab name). Stamped onto every
  // flow node that points at the session when it's renamed; drives the session
  // folder name in the file tree and a `git clone` (falls back to the session id
  // when unset). See sessionStore.renameSession.
  sessionName?: string;

  // Error-handling policy when the node fails during a flow run.
  //   'stop'     — (default) abort the whole flow
  //   'continue' — log a [FLOW] line and carry on with a null result
  //   'retry'    — re-run per `retry` config, then stop if still failing
  onError?: 'stop' | 'continue' | 'retry';
  retry?: {
    maxAttempts: number;                          // total attempts incl. the first (>=1)
    delaySec: number;                             // delay before each retry, in seconds
    backoff: 'fixed' | 'linear' | 'exponential';
  };

  // Execution status overlay (set during live execution view)
  executionStatus?: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'retrying';
  executionAttempt?: number;
}

export interface ConnectionItemProps {
  id: string;
  label: string;
  onRemove: () => void;
}

export interface NodeDimensions {
  width: number;
  height: number;
}

export interface EdgeConnection {
  id: string;
  source: string;
  target: string;
}

export type NodeType = Node<NodeData>;
export type EdgeType = Edge;

