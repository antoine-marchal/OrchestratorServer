import React, { useEffect } from 'react';
import FlowEditor from './components/FlowEditor';
import CodeEditorModal from './components/CodeEditorModal.tsx';
import SessionTabs from './components/SessionTabs';
import { useFlowStore } from './store/sessionFlowStore';
import { useSessionStore } from './store/sessionStore';


// TODO: Remove preload dependencies - electronAPI will be replaced with HTTP APIs

function App() {
  const { editorModal, nodes, closeEditorModal, setNodes, setEdges, setFlowPath, saveFlow, loadFlow } = useFlowStore();
  const { loadSessions } = useSessionStore();

  // Initialize sessions on app start
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // TODO: Remove preload dependencies - flow loading will be handled via HTTP APIs
  // Removed useEffect that listened for window.electronAPI.onLoadFlowJson
  useEffect(() => {
    function handleShortcuts(e: KeyboardEvent) {
      // Block global shortcuts if editor modal is open
      if (editorModal.isOpen) return;

      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isSave = (isMac && e.metaKey && e.key.toLowerCase() === 's') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 's');
      const isOpen = (isMac && e.metaKey && e.key.toLowerCase() === 'o') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 'o');
      if (isSave) {
        e.preventDefault();
        saveFlow();
      }
      if (isOpen) {
        e.preventDefault();
        loadFlow();
      }
    }
    window.addEventListener('keydown', handleShortcuts, true);
    return () => window.removeEventListener('keydown', handleShortcuts, true);
  }, [editorModal.isOpen, saveFlow, loadFlow]);


  const node = nodes.find(n => n.id === editorModal.nodeId);

  return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
        <SessionTabs />
        <div className="flex-1">
          <FlowEditor />
        </div>
        {editorModal.isOpen && node && (
          <CodeEditorModal
            nodeId={node.id}
            code={node.data.code || ''}
            language={node.data.language || 'javascript'}
            onClose={closeEditorModal}
          />
        )}
      </div>
  );
}

export default App;
