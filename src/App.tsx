import React, { useEffect } from 'react';
import FlowEditor from './components/FlowEditor';
import CodeEditorModal from './components/CodeEditorModal.tsx';
import { useFlowStore } from './store/flowStore';


// Make TS happy with the global
declare global {
  interface Window {
    electronAPI?: {
      onLoadFlowJson: (
        callback: (payload: [string, string | null]) => void
      ) => void;
      setTitle?: (title: string) => void;
      saveFlowToPath?: (path: string, data: string) => void;
      openFlowFile?: () => Promise<{ filePath: string; data: string } | null>;
      saveFlowAs?: (data: string) => Promise<string | null>;
    }
  }
}

function App() {
  const { editorModal, nodes, closeEditorModal, setNodes, setEdges, setFlowPath, saveFlow, loadFlow } = useFlowStore();


  useEffect(() => {
    const api = window.electronAPI;
    if (api && api.onLoadFlowJson) {
      api.onLoadFlowJson(([filePath, data]) => {  
        console.log(filePath);
        if (data) {
          try {
            const flow = JSON.parse(data);
            setNodes(flow.nodes || []);
            setEdges(flow.edges || []);
            setFlowPath(filePath);
            // Set window title to include file path (or just filename)
            const fileName = filePath.split(/[\\/]/).pop();
            if (fileName) api.setTitle?.(fileName);
          } catch (err) {
            alert('Error loading flow from file: ' + err);
          }
        }
      });
    }
  }, [setNodes, setEdges,]);
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

        <FlowEditor />
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
