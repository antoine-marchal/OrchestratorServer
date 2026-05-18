import { Node } from 'reactflow';
import { useSessionStore } from '../store/sessionStore';

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
  const newNode = {
    id: `node-${Date.now()}`,
    type: 'custom',
    position: position || { x: 100, y: 100 },
    data: {
      label: flowName,
      type: 'flow' as const,
      code: '',
      flowRef: flowId,
      isRelativePath: false,
    },
    draggable: true,
  };
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

  const newNode = {
    id: `node-${Date.now()}`,
    type: 'custom',
    position: position || { x: 100, y: 100 },
    data: {
      label: sessionName,
      type: 'flow' as const,
      code: flowContent,
      isRelativePath: false,
      linkedSessionId: sessionId,
    },
    draggable: true,
  };

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

    const newNode = {
      id: `node-${Date.now()}`,
      type: 'custom',
      position: position || { x: 100, y: 100 },
      data: {
        label: flowName,
        type: 'flow' as const,
        code: fileContent,
        isRelativePath: false,
        linkedSessionId: newSessionId,
      },
      draggable: true,
    };

    if (currentSessionId) {
      useSessionStore.getState().switchSession(currentSessionId);
      setNodes((nds) => [...nds, newNode]);
    }
  } catch (error) {
    alert(`Error creating flow node: ${error instanceof Error ? error.message : String(error)}`);
  }
};
