import React from 'react';
import {
  Code2,
  Hash,
  Edit2,
  Play,
  Trash2,
  GitBranch,
  FileCode,
  Server,
  Coffee,
  Terminal,
  TerminalSquare,
  MessageSquare,
  Flag,
  AlarmClockOff,
  Square,
  CornerRightDown
} from 'lucide-react';
import { NodeData } from '../../types/node';
import { useFlowStore } from '../../store/sessionFlowStore';
import { pathUtils } from '../../utils/pathUtils';
interface NodeHeaderProps {
  data: NodeData;
  nodeId: string;
  onLabelChange: (label: string) => void;
  onValueChange?: (value: string) => void;
  onExecute: () => void;
  onDelete: () => void;
}

export const NodeHeader: React.FC<NodeHeaderProps> = ({
  data,
  nodeId,
  onLabelChange,
  onValueChange,
  onExecute,
  onDelete,
}) => {
  const { openEditorModal, updateNodeDraggable, updatePanOnDrag, setStarterNode, toggleDontWaitForOutput, nodeLoading, stopNodeExecution, setTitleEditing, updateCodeFilePath } = useFlowStore();
  
  // Check if the node is currently loading/executing
  const isNodeExecuting = nodeLoading?.[nodeId] || false;
  
  // Check if this node has dontWaitForOutput enabled
  const hasDontWaitForOutput = data.dontWaitForOutput;
  const openFlowNodeInNewWindow = async() => {
    // Opening flows in new windows is not supported in browser environment
    alert('Opening flows in new windows is not supported in the browser version. Double-click the flow node to see details.');
  }
  return (
    <div className="p-4 border-b border-gray-700 dark:border-gray-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">

          {(() => {
            switch (data.type) {
              case 'constant':
                return <Hash className="w-5 h-5 text-purple-500 flex-shrink-0" />;
              case 'flow':
                return <GitBranch className="w-5 h-5 text-emerald-500 flex-shrink-0" />;
              case 'javascript':
                return <FileCode className="w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0" />;
              case 'jsbackend':
                return <Server className="w-5 h-5 text-blue-500 flex-shrink-0" />;
              case 'groovy':
                return <Coffee className="w-5 h-5 text-red-500 flex-shrink-0" />;
              case 'batch':
                return <Terminal className="w-5 h-5 text-gray-400 flex-shrink-0" />;
              case 'powershell':
                return <TerminalSquare className="w-5 h-5 text-blue-400 flex-shrink-0" />;
              case 'goto':
                return <CornerRightDown className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />;   
              case 'comment':
                return <MessageSquare className="w-5 h-5 text-gray-500 flex-shrink-0" />;
              default:
                return <Code2 className="w-5 h-5 text-blue-500 flex-shrink-0" />;
            }
          })()}
          <input
            type="text"
            value={data.label}
            onChange={(e) => onLabelChange(e.target.value)}
            onFocus={(e) => {
              e.target.select();
              setTitleEditing(true);
            }}
            onBlur={(e) => {
              setTitleEditing(false);
              updateCodeFilePath(nodeId,e.target.value);
            }}
            onMouseEnter={() => {
              updateNodeDraggable(nodeId, false);
              updatePanOnDrag(false);
            }}
            onMouseLeave={() => {
              updateNodeDraggable(nodeId, true);
              updatePanOnDrag(true);
            }}
            className="font-semibold text-black dark:text-white bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 w-full"
          />
        </div>
        <div className="flex items-center gap-2">
          {data.type !== 'constant' && data.type !== 'flow' && data.type !== 'goto' && (
            <button
              className="p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
              onClick={() => openEditorModal(nodeId)}
            >
              <Edit2 className="w-4 h-4 text-blue-500" />
            </button>
          )}
          {data.type === 'flow' && (
            <button
              className="p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
              onClick={() => openFlowNodeInNewWindow()}
            >
              <Edit2 className="w-4 h-4 text-blue-500" />
            </button>
          )}
          {data.type !== 'goto' && (
          <button
            className={`p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded ${isNodeExecuting ? 'cursor-not-allowed opacity-50' : ''}`}
            onClick={onExecute}
            title={isNodeExecuting ? "Node is already running" : "Execute node"}
          >
            <Play className="w-4 h-4 text-green-500" />
          </button>
          )}
          {data.type !== 'goto' && (
          <button
            className={`p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded ${data.isStarterNode ? 'bg-gray-400 dark:bg-gray-700' : ''}`}
            onClick={() => setStarterNode(nodeId)}
            title={data.isStarterNode ? "Unset as starter node" : "Set as starter node"}
          >
            <Flag className={`w-4 h-4 ${data.isStarterNode ? 'text-yellow-500' : 'text-gray-500'}`} />
          </button>
          )}
          {/* Stop button (shown when node is executing) */}
          {data.type !== 'goto' && isNodeExecuting && (
            <button
              className="p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
              onClick={() => stopNodeExecution(nodeId)}
              title="Stop execution"
            >
              <Square className="w-4 h-4 text-red-500" />
            </button>
          )}
          {data.type !== 'goto' && !isNodeExecuting && (
            <button
              className={`p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded ${hasDontWaitForOutput ? 'bg-gray-400 dark:bg-gray-700' : ''}`}
              onClick={() => toggleDontWaitForOutput(nodeId)}
              title={hasDontWaitForOutput ? "Wait for output (currently set to don't wait)" : "Don't wait for output"}
            >
              <AlarmClockOff className={`w-4 h-4 ${hasDontWaitForOutput ? 'text-yellow-500' : 'text-gray-500'}`} />
            </button>
          )}
          {isNodeExecuting ? (
          <button
            className="p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </button>
           ) : (
            <button
            className="p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
            onClick={onDelete}
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </button>
          )}
        </div>
      </div>
      {/* Value input below title for constants */}
      {data.type === 'constant' && onValueChange && (
        <input
          type="text"
          value={data.value || ''}
          onChange={(e) => onValueChange(e.target.value)}
          className="mt-2 text-base bg-gray-200 dark:bg-gray-700 border-none rounded px-2 py-1 text-black dark:text-white w-full font-mono"
          placeholder="Value…"
          onFocus={(e) => {
            e.target.select();
            setTitleEditing(true);
          }}
          onBlur={() => {
            setTitleEditing(false);
          }}
          onMouseEnter={() => {
            updateNodeDraggable(nodeId, false);
            updatePanOnDrag(false);
          }}
          onMouseLeave={() => {
            updateNodeDraggable(nodeId, true);
            updatePanOnDrag(true);
          }}
        />
      )}
    </div>
  );
};
