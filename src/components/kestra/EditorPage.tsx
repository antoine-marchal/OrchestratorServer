import React, { useEffect } from 'react';
import FlowEditor from '../FlowEditor';
import CodeEditorModal from '../CodeEditorModal.tsx';
import SessionTabs from '../SessionTabs';
import { useFlowStore } from '../../store/sessionFlowStore';

const EditorPage: React.FC = () => {
  const { editorModal, nodes, closeEditorModal, saveFlow, loadFlow } = useFlowStore();

  useEffect(() => {
    function handleShortcuts(e: KeyboardEvent) {
      if (editorModal.isOpen) return;
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isSave = (isMac && e.metaKey && e.key.toLowerCase() === 's') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 's');
      const isOpen = (isMac && e.metaKey && e.key.toLowerCase() === 'o') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 'o');
      if (isSave) { e.preventDefault(); saveFlow(); }
      if (isOpen) { e.preventDefault(); loadFlow(); }
    }
    window.addEventListener('keydown', handleShortcuts, true);
    return () => window.removeEventListener('keydown', handleShortcuts, true);
  }, [editorModal.isOpen, saveFlow, loadFlow]);

  const node = nodes.find(n => n.id === editorModal.nodeId);

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      <SessionTabs />
      <div className="flex-1 min-h-0">
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
};

export default EditorPage;
