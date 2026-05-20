import React, { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import NodeFileTree from './NodeFileTree';
import NodeCodePanel from './NodeCodePanel';
import VersionHistoryPanel from './VersionHistoryPanel';

interface EditorLayoutProps {
  graphPanel: React.ReactNode;
  embedded?: boolean;
  flowId?: string;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({ graphPanel, flowId }) => {
  const sessionStore = useSessionStore();
  const flowState = sessionStore.getActiveFlowState();
  const activeCard = flowState?.activeCard ?? 'graph';
  const editingNodeId = flowState?.editingNodeId ?? null;
  const [treeWidth, setTreeWidth] = useState(200);
  const [versionsWidth, setVersionsWidth] = useState(280);
  const [showVersions, setShowVersions] = useState(false);
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
      <div className="flex-1 overflow-hidden relative">
        {activeCard === 'code' && editingNodeId ? (
          <NodeCodePanel nodeId={editingNodeId} />
        ) : (
          graphPanel
        )}
        {/* Toggle for the version history rail — fixed at the right edge of
            the canvas, never overlaps the resizable panel itself. */}
        <button
          onClick={() => setShowVersions(v => !v)}
          title={showVersions ? 'Hide version history' : 'Show version history'}
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 5,
            height: 26, padding: '0 10px', borderRadius: 6,
            background: showVersions ? 'var(--accent-soft)' : 'var(--surface)',
            border: '1px solid var(--border)', color: 'var(--text-2)',
            fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
          }}
        >
          versions
        </button>
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
