import React from 'react';
import { Panel } from 'reactflow';
import ToolbarButton from './ToolbarButton';
import NodeCreationMenu from './NodeCreationMenu';
import {
  Save,
  Upload,
  Trash2,
  PlayCircle,
  Layout,
  Plus,
  FilePlus,
  XCircle,
  Undo,
  Redo,
  Copy,
  Clipboard,
} from 'lucide-react';

interface FlowEditorToolbarProps {
  // File operations
  createNewFlow: () => void;
  saveFlow: () => void;
  loadFlow: () => void;

  // Flow operations
  clearFlow: () => void;
  executeFlow: () => void;
  stopFlow: () => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Clipboard
  handleCopyNodes: () => void;
  handlePasteNodes: () => void;
  selectedNodes: string[];

  // Utility
  handlePrettifyFlow: () => void;
  clearAllOutputs: () => void;

  // Add node
  handleAddNodeClick: () => void;
  dropdownMenu: boolean;
  addNewNode: (type: string, position?: { x: number; y: number }) => void;
}

const FlowEditorToolbar: React.FC<FlowEditorToolbarProps> = ({
  createNewFlow,
  saveFlow,
  loadFlow,
  clearFlow,
  executeFlow,
  stopFlow,
  undo,
  redo,
  canUndo,
  canRedo,
  handleCopyNodes,
  handlePasteNodes,
  selectedNodes,
  handlePrettifyFlow,
  clearAllOutputs,
  handleAddNodeClick,
  dropdownMenu,
  addNewNode,
}) => {
  return (
    <Panel position="top-right" className="flex gap-2 flex-wrap">
      {/* File Operations Group */}
      <div className="flex gap-2 mr-2">
        <ToolbarButton
          onClick={createNewFlow}
          icon={FilePlus}
          label="New Flow"
          color="bg-teal-500 hover:bg-teal-600"
          title="New Flow (Ctrl+N)"
        />
        <ToolbarButton
          onClick={saveFlow}
          icon={Save}
          label="Save Flow"
          color="bg-blue-500 hover:bg-blue-600"
          title="Save Flow (Ctrl+S)"
        />
        <ToolbarButton
          onClick={loadFlow}
          icon={Upload}
          label="Load Flow"
          color="bg-green-500 hover:bg-green-600"
          title="Load Flow (Ctrl+O)"
        />
      </div>

      {/* Flow Operations Group */}
      <div className="flex gap-2 mr-2">
        <ToolbarButton
          onClick={clearFlow}
          icon={Trash2}
          label="Erase Flow"
          color="bg-red-500 hover:bg-red-600"
          title="Erase Flow (Ctrl+D)"
        />
        <ToolbarButton
          onClick={executeFlow}
          icon={PlayCircle}
          label="Run Flow"
          color="bg-yellow-500 hover:bg-yellow-600"
          title="Run Flow (Ctrl+R)"
        />
        <ToolbarButton
          onClick={stopFlow}
          icon={XCircle}
          label="Stop Flow"
          color="bg-red-600 hover:bg-red-700"
          title="Stop Flow Execution"
        />
      </div>

      {/* History Navigation Group */}
      <div className="flex gap-2 mr-2">
        <ToolbarButton
          onClick={undo}
          icon={Undo}
          label="Undo"
          color={canUndo() ? 'bg-gray-500 hover:bg-gray-600' : 'bg-gray-400'}
          title="Undo (Ctrl+Z)"
        />
        <ToolbarButton
          onClick={redo}
          icon={Redo}
          label="Redo"
          color={canRedo() ? 'bg-gray-500 hover:bg-gray-600' : 'bg-gray-400'}
          title="Redo (Ctrl+Y)"
        />
      </div>

      {/* Clipboard Operations Group */}
      <div className="flex gap-2 mr-2">
        <ToolbarButton
          onClick={handleCopyNodes}
          icon={Copy}
          label="Copy"
          color={selectedNodes.length > 0 ? 'bg-purple-500 hover:bg-purple-600' : 'bg-purple-400'}
          title="Copy Selected Nodes (Ctrl+C)"
        />
        <ToolbarButton
          onClick={handlePasteNodes}
          icon={Clipboard}
          label="Paste"
          color="bg-purple-500 hover:bg-purple-600"
          title="Paste Nodes (Ctrl+V)"
        />
      </div>

      {/* Utility Operations Group */}
      <div className="flex gap-2 mr-2">
        <ToolbarButton
          onClick={handlePrettifyFlow}
          icon={Layout}
          label="Prettify"
          color="bg-indigo-500 hover:bg-indigo-600"
          title="Prettify (Ctrl+P)"
        />
        <ToolbarButton
          onClick={clearAllOutputs}
          icon={XCircle}
          label="Clear Output"
          color="bg-orange-500 hover:bg-orange-600"
          title="Clear All Node Outputs (Ctrl+W)"
        />
      </div>

      {/* Add Node Button with Dropdown */}
      <div className="relative">
        <ToolbarButton
          onClick={handleAddNodeClick}
          icon={Plus}
          label="Add Node"
          color="bg-purple-500 hover:bg-purple-600"
          title="Add Node"
        />
        {dropdownMenu && <NodeCreationMenu onAddNode={addNewNode} type="dropdown" />}
      </div>
    </Panel>
  );
};

export default FlowEditorToolbar;
