import React, { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import NodeFileTree from './NodeFileTree';
import NodeCodePanel from './NodeCodePanel';
import VersionHistoryPanel from './VersionHistoryPanel';

interface EditorLayoutProps {
  graphPanel: React.ReactNode;
  embedded?: boolean;
  flowId?: string;
  showVersions?: boolean;
  onToggleVersions?: () => void;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({ graphPanel, flowId, showVersions, onToggleVersions: _onToggleVersions }) => {
  void _onToggleVersions; // visibility controlled by parent; nothing to do here.
  const sessionStore = useSessionStore();
  const flowState = sessionStore.getActiveFlowState();
  const activeCard = flowState?.activeCard ?? 'graph';
  const editingNodeId = flowState?.editingNodeId ?? null;
  const [treeWidth, setTreeWidth] = useState(200);
  const [versionsWidth, setVersionsWidth] = useState(280);
  const drag = useRef<{ x: number; w: number; side: 'left' | 'right' } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      if (drag.current.side === 'left') {
        setTreeWidth(Math.min(Math.max(drag.current.w + dx, 100), 420));
      } else {
        // Right handle: drag left to widen.
        setVersionsWidth(Math.min(Math.max(drag.current.w - dx, 200), 560));
      }
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Node file tree sidebar — resizable */}
      <div style={{ width: treeWidth, flexShrink: 0, overflow: 'hidden' }}>
        <NodeFileTree />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={e => {
          drag.current = { x: e.clientX, w: treeWidth, side: 'left' };
          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
        }}
        style={{
          width: 9, cursor: 'ew-resize', flexShrink: 0,
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{ width: 3, height: 24, borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }} />
      </div>

      {/* Main panel — switches between graph and code editor */}
      <div className="flex-1 overflow-hidden">
        {activeCard === 'code' && editingNodeId ? (
          <NodeCodePanel nodeId={editingNodeId} />
        ) : (
          graphPanel
        )}
      </div>

      {showVersions && (
        <>
          <div
            onMouseDown={e => {
              drag.current = { x: e.clientX, w: versionsWidth, side: 'right' };
              document.body.style.cursor = 'ew-resize';
              document.body.style.userSelect = 'none';
            }}
            style={{
              width: 9, cursor: 'ew-resize', flexShrink: 0,
              background: 'var(--surface)', borderLeft: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{ width: 3, height: 24, borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }} />
          </div>
          <div style={{ width: versionsWidth, flexShrink: 0, overflow: 'hidden' }}>
            <VersionHistoryPanel flowId={flowId} />
          </div>
        </>
      )}
    </div>
  );
};

export default EditorLayout;
