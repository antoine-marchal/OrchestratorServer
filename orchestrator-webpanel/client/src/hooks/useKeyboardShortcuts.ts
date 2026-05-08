import { useEffect } from 'react';

interface KeyboardShortcutsConfig {
  clearFlow: () => void;
  executeFlow: () => void;
  clearAllOutputs: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  selectedNodes: string[];
  copySelectedNodes: (nodeIds: string[]) => void;
  handlePasteNodes: () => void;
  createNewFlow: () => void;
  handlePrettifyFlow: () => void;
  editorModal: { isOpen: boolean };
  isOutputZoneActive: boolean;
  isTitleEditing: boolean;
  isMouseOverConsole: boolean;
}

export const useKeyboardShortcuts = (config: KeyboardShortcutsConfig) => {
  const {
    clearFlow,
    executeFlow,
    clearAllOutputs,
    undo,
    redo,
    canUndo,
    canRedo,
    selectedNodes,
    copySelectedNodes,
    handlePasteNodes,
    createNewFlow,
    handlePrettifyFlow,
    editorModal,
    isOutputZoneActive,
    isTitleEditing,
    isMouseOverConsole,
  } = config;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent default browser actions for our shortcuts
      if (event.ctrlKey || event.metaKey) {
        // Get current state of output zone, title editing, and mouse over console
        const isModalOpen = editorModal.isOpen;

        const activeTag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
        const isInputFocused = activeTag === 'input' || activeTag === 'textarea';
        // Skip handling CTRL+C and CTRL+V when modal editor is open, output zone is active, title is being edited, mouse is over console, or an input is focused
        const shouldSkipCopyPaste = isModalOpen || isOutputZoneActive || isTitleEditing || isMouseOverConsole || isInputFocused;

        switch (event.key.toLowerCase()) {
          case 'n':
            event.preventDefault();
            createNewFlow();
            break;
          case 'd':
            event.preventDefault();
            clearFlow();
            break;
          case 'r':
            event.preventDefault();
            executeFlow();
            break;
          case 'p':
            event.preventDefault();
            handlePrettifyFlow();
            break;
          case 'w':
            event.preventDefault();
            clearAllOutputs();
            break;
          case 'z':
            event.preventDefault();
            if (canUndo()) undo();
            break;
          case 'y':
            event.preventDefault();
            if (canRedo()) redo();
            break;
          case 'c':
            // Only handle copy if we're not in a special state and have selected nodes
            if (!shouldSkipCopyPaste && selectedNodes.length > 0) {
              event.preventDefault();
              copySelectedNodes(selectedNodes);
            }
            break;
          case 'v':
            // Only handle paste if we're not in a special state
            if (!shouldSkipCopyPaste) {
              event.preventDefault();
              handlePasteNodes();
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    clearFlow,
    executeFlow,
    clearAllOutputs,
    undo,
    redo,
    canUndo,
    canRedo,
    selectedNodes,
    copySelectedNodes,
    handlePasteNodes,
    createNewFlow,
    handlePrettifyFlow,
    editorModal.isOpen,
    isOutputZoneActive,
    isTitleEditing,
    isMouseOverConsole,
  ]);
};
