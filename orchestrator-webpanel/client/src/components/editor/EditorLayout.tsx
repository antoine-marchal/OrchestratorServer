import React from 'react';
import { useSessionStore } from '../../store/sessionStore';
import NodeFileTree from './NodeFileTree';
import NodeCodePanel from './NodeCodePanel';

interface EditorLayoutProps {
  graphPanel: React.ReactNode;
  embedded?: boolean;
  flowId?: string;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({ graphPanel }) => {
  const sessionStore = useSessionStore();
  const flowState = sessionStore.getActiveFlowState();
  const activeCard = flowState?.activeCard ?? 'graph';
  const editingNodeId = flowState?.editingNodeId ?? null;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Node file tree sidebar — always visible */}
      <div style={{ width: 200, flexShrink: 0 }}>
        <NodeFileTree />
      </div>

      {/* Main panel — switches between graph and code editor */}
      <div className="flex-1 overflow-hidden">
        {activeCard === 'code' && editingNodeId ? (
          <NodeCodePanel nodeId={editingNodeId} />
        ) : (
          graphPanel
        )}
      </div>
    </div>
  );
};

export default EditorLayout;
