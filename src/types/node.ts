import { Node, Edge } from 'reactflow';

export interface NodeData {
  label: string;
  type: 'variable' | 'javascript' | 'jsbackend' | 'groovy' | 'batch' | 'powershell' | 'flow' | 'comment' | 'goto';
  language?: string;
  code?: string;
  codeFilePath?: string;
  value?: string;
  input?: any;
  output?: any;
  executionTime?: number;
  isRelativePath?: boolean;
  isStarterNode?: boolean;
  dontWaitForOutput?: boolean;
  jobId?: string;
  
  //Add Goto-specific fields
  conditions?: Array<{
    expr: string;        // JS expression, e.g. "input.value < 50"
    goto: string;        // nodeId to jump to
    forwardInput?: boolean;
  }>;
  gotoDecision?: string | null; // transient decision during "run entire flow"
  
  // Linked session for editing flow nodes
  linkedSessionId?: string;
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

