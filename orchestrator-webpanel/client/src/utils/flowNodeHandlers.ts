import { Node } from 'reactflow';
import { useSessionStore } from '../store/sessionStore';
import { makeFlowNode } from '../store/flowNodeContent';

export interface FlowNodeFromLibraryParams {
  flowId: string;
  flowName: string;
  position: { x: number; y: number };
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
}

export const handleFlowNodeFromLibrary = ({
  flowId,
  flowName,
  position,
  setNodes,
}: FlowNodeFromLibraryParams) => {
  const newNode = makeFlowNode({ label: flowName, flowRef: flowId, position });
  setNodes((nds) => [...nds, newNode]);
};

export interface FlowNodeFromSessionParams {
  sessionId: string;
  sessionName: string;
  position: { x: number; y: number };
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
}

export interface FlowNodeFromFileParams {
  file: File;
  position: { x: number; y: number };
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
  currentSessionId: string | null;
  parentFlowId?: string;
}

export const handleFlowNodeFromSession = ({
  sessionId,
  sessionName,
  position,
  setNodes,
}: FlowNodeFromSessionParams) => {
  const session = useSessionStore.getState().getSession(sessionId);
  if (!session) {
    alert('Session not found');
    return;
  }

  const flowContent = JSON.stringify({
    nodes: session.flowState.nodes,
    edges: session.flowState.edges,
  });

  const newNode = makeFlowNode({ label: sessionName, linkedSessionId: sessionId, code: flowContent, position });
  setNodes((nds) => [...nds, newNode]);
};

export interface FlowNodeNewSessionParams {
  position: { x: number; y: number };
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
  parentFlowId?: string;
}

// Create a brand-new empty editor session and add a flow node linked to it.
// The node lands in the CURRENT flow; the new (empty) session is created in this
// flow's scope so it shows up in the session pickers (issue 3 follow-up).
export const handleFlowNodeNewSession = async ({
  position,
  setNodes,
  parentFlowId,
}: FlowNodeNewSessionParams) => {
  const store = useSessionStore.getState();
  const originalSessionId = store.activeSessionId;
  const name = 'Sub-flow';
  const sessionId = await store.createSession(name, parentFlowId); // switches active to the new empty session
  const code = JSON.stringify({ nodes: [], edges: [] });
  const newNode = makeFlowNode({ label: name, linkedSessionId: sessionId, code, position });
  // Re-focus the originating flow and drop the node into it.
  if (originalSessionId) store.switchSession(originalSessionId);
  setNodes((nds) => [...nds, newNode]);
};

export const handleFlowNodeFromFile = async ({
  file,
  position,
  setNodes,
  currentSessionId,
  parentFlowId,
}: FlowNodeFromFileParams) => {
  try {
    const fileContent = await file.text();
    const fileName = file.name;
    const flowName = fileName.replace('.or', '');

    const flowData = JSON.parse(fileContent);
    if (!flowData || !Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) {
      throw new Error('Invalid flow file format: missing nodes or edges');
    }

    const newSessionName = `Flow: ${flowName}`;
    const newSessionId = await useSessionStore.getState().createSession(newSessionName, parentFlowId);

    useSessionStore.getState().updateActiveFlowState({
      nodes: flowData.nodes,
      edges: flowData.edges,
      flowPath: fileName,
      history: [],
      historyIndex: -1,
    });

    const newNode = makeFlowNode({ label: flowName, linkedSessionId: newSessionId, code: fileContent, position });

    if (currentSessionId) {
      useSessionStore.getState().switchSession(currentSessionId);
      setNodes((nds) => [...nds, newNode]);
    }
  } catch (error) {
    alert(`Error creating flow node: ${error instanceof Error ? error.message : String(error)}`);
  }
};
