import { Node, Edge } from 'reactflow';
import { useSessionStore } from '../store/sessionStore';

export interface FlowNodeFromSessionParams {
  sessionId: string;
  sessionName: string;
  position: { x: number; y: number };
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
  switchSession: (sessionId: string) => void;
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
  switchSession,
}: FlowNodeFromSessionParams) => {
  const session = useSessionStore.getState().getSession(sessionId);
  if (!session) {
    alert('Session not found');
    return;
  }

  const nodePosition = position || { x: 100, y: 100 };

  // Serialize the session's flow state to JSON
  const flowContent = JSON.stringify({
    nodes: session.flowState.nodes,
    edges: session.flowState.edges,
  });

  const newNode = {
    id: `node-${Date.now()}`,
    type: 'custom',
    position: nodePosition,
    data: {
      label: sessionName,
      type: 'flow' as const,
      code: flowContent,
      isRelativePath: false,
      linkedSessionId: sessionId, // Link directly to the existing session
    },
    draggable: true,
  };

  setNodes((nds) => [...nds, newNode]);

  // Switch to the linked session so user can view/edit it
  switchSession(sessionId);
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

    // Parse and validate the flow content
    const flowData = JSON.parse(fileContent);
    if (!flowData || !Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) {
      throw new Error('Invalid flow file format: missing nodes or edges');
    }

    const nodePosition = position || { x: 100, y: 100 };

    // Create a new session for this flow
    const newSessionName = `Flow: ${flowName}`;
    const newSessionId = await useSessionStore.getState().createSession(newSessionName, parentFlowId);

    // Load the flow data into the new session
    useSessionStore.getState().updateActiveFlowState({
      nodes: flowData.nodes,
      edges: flowData.edges,
      flowPath: fileName,
      history: [],
      historyIndex: -1,
    });

    // Create the flow node linked to the new session
    const newNode = {
      id: `node-${Date.now()}`,
      type: 'custom',
      position: nodePosition,
      data: {
        label: flowName,
        type: 'flow' as const,
        code: fileContent,
        isRelativePath: false,
        linkedSessionId: newSessionId, // Link to the newly created session
      },
      draggable: true,
    };

    // Switch back to original session to add the node
    if (currentSessionId) {
      useSessionStore.getState().switchSession(currentSessionId);
      setNodes((nds) => [...nds, newNode]);

      // Then switch to the new session to show the uploaded flow
      useSessionStore.getState().switchSession(newSessionId);
    }
  } catch (error) {
    alert(`Error creating flow node: ${error instanceof Error ? error.message : String(error)}`);
  }
};
