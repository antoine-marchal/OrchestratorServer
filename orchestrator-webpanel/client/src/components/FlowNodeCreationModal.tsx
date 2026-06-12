import { useState } from 'react';
import { X, Upload, List, GitBranch, FilePlus } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { useFlowLibraryStore } from '../store/flowLibraryStore';

interface FlowNodeCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string, sessionName: string) => void;
  onUploadFile: (file: File) => void;
  onSelectLibraryFlow: (flowId: string, flowName: string) => void;
  /** Create a brand-new empty session and link the node to it. */
  onCreateNewSession?: () => void;
  flowId?: string;
  /** 'modify' re-points an existing flow node; 'create' (default) adds a new one. */
  mode?: 'create' | 'modify';
  /** Sessions of THIS flow whose editor tab was closed (still selectable — issue 3). */
  closedSessions?: Array<{ id: string; name: string }>;
  /** The flow node's current link, to mark it in the list. */
  currentLinkedSessionId?: string;
}

export default function FlowNodeCreationModal({
  isOpen,
  onClose,
  onSelectSession,
  onUploadFile,
  onSelectLibraryFlow,
  onCreateNewSession,
  flowId,
  mode = 'create',
  closedSessions = [],
  currentLinkedSessionId,
}: FlowNodeCreationModalProps) {
  const [selectedOption, setSelectedOption] = useState<'session' | 'library' | null>(null);
  const { sessions: allSessions, activeSessionId } = useSessionStore();
  const { flows } = useFlowLibraryStore();
  const liveSessions = (flowId ? allSessions.filter(session => session.linkedFlowId === flowId) : allSessions)
    .filter(session => session.id !== activeSessionId);
  // Sub-flow sessions of this flow, live OR closed (issue 3). Closed sessions are
  // reconstructed from the flow nodes that still reference them.
  const liveIds = new Set(liveSessions.map(s => s.id));
  const sessions: Array<{ id: string; name: string; nodes: number; edges: number; closed: boolean }> = [
    ...liveSessions.map(s => ({ id: s.id, name: s.name, nodes: s.flowState.nodes.length, edges: s.flowState.edges.length, closed: false })),
    ...closedSessions.filter(c => !liveIds.has(c.id)).map(c => ({ id: c.id, name: c.name, nodes: 0, edges: 0, closed: true })),
  ];

  // Exclude the current flow from the library list to prevent circular references
  const libraryFlows = flows.filter(f => f.id !== flowId);

  if (!isOpen) return null;

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.or';
    input.style.display = 'none';

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.or')) {
        alert('Please select a valid .or file');
        return;
      }
      onUploadFile(file);
      onClose();
    };

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  };

  const handleSessionSelect = (sessionId: string, sessionName: string) => {
    onSelectSession(sessionId, sessionName);
    onClose();
  };

  const handleLibrarySelect = (fId: string, fName: string) => {
    onSelectLibraryFlow(fId, fName);
    onClose();
  };

  const handleCreateNewSession = () => {
    onCreateNewSession?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, width: '100%', maxWidth: 440, margin: '0 16px' }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
            {mode === 'modify' ? 'Modify Flow Node' : 'Create Flow Node'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 16 }}>
          {!selectedOption ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {onCreateNewSession && (
                <button
                  onClick={handleCreateNewSession}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
                >
                  <FilePlus size={18} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Create New Session</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Start an empty sub-flow session and link it</div>
                  </div>
                </button>
              )}
              <button
                onClick={() => setSelectedOption('library')}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
              >
                <GitBranch size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Reference Library Flow</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Link to an existing flow — edit opens the referenced flow</div>
                </div>
              </button>

              <button
                onClick={() => setSelectedOption('session')}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
              >
                <List size={18} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Select Existing Session</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Embed a flow from an open editor session</div>
                </div>
              </button>

              <button
                onClick={handleFileUpload}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
              >
                <Upload size={18} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Upload .or File</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Embed a flow from a file on your computer</div>
                </div>
              </button>
            </div>
          ) : selectedOption === 'library' ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Select a flow from the library:</span>
                <button onClick={() => setSelectedOption(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11 }}>Back</button>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {libraryFlows.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: '16px 0' }}>No flows available</p>
                ) : (
                  libraryFlows.map(f => (
                    <button
                      key={f.id}
                      onClick={() => handleLibrarySelect(f.id, f.name)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
                    >
                      <GitBranch size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{f.namespace} · {f.nodes?.length ?? 0} nodes</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Select a session:</span>
                <button onClick={() => setSelectedOption(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11 }}>Back</button>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sessions.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: '16px 0' }}>No sessions available</p>
                ) : (
                  sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => handleSessionSelect(session.id, session.name)}
                      style={{ display: 'flex', flexDirection: 'column', padding: '8px 10px', background: 'var(--bg-3)', border: `1px solid ${session.id === currentLinkedSessionId ? 'var(--ok)' : 'var(--border)'}`, borderRadius: 5, cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
                    >
                      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {session.name}
                        {session.closed && <span style={{ color: 'var(--warn)', marginLeft: 6, fontSize: 10 }}>(closed)</span>}
                        {session.id === currentLinkedSessionId && <span style={{ color: 'var(--ok)', marginLeft: 6, fontSize: 10 }}>(current)</span>}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                        {session.closed ? `id: ${session.id}` : `${session.nodes} nodes, ${session.edges} edges`}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="tc-btn ghost" style={{ height: 28, padding: '0 12px', fontSize: 12 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
