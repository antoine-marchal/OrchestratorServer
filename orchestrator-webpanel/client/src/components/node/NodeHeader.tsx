import React from 'react';
import { useNavigate } from 'react-router-dom';
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
  Ban,
  ChevronsRight,
  RotateCw,
  Square,
  CornerRightDown,
  Link2
} from 'lucide-react';
import { NodeData } from '../../types/node';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import { openFlowNodeEditor } from '../../store/flowNodeContent';
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
  const navigate = useNavigate();
  const { openEditorModal, updateNodeDraggable, updatePanOnDrag, setStarterNode, nodeLoading, stopNodeExecution, setTitleEditing, updateCodeFilePath, updateNodeData } = useFlowStore();
  const sessionStore = useSessionStore();

  // Check if the node is currently loading/executing
  const isNodeExecuting = nodeLoading?.[nodeId] || false;

  // On-error policy: stop (default) → continue → retry, cycled by the button.
  const onErrorMode: 'stop' | 'continue' | 'retry' =
    data.onError === 'continue' || data.onError === 'retry' ? data.onError : 'stop';
  const retryCfg = data.retry || { maxAttempts: 3, delaySec: 5, backoff: 'fixed' as const };
  const cycleErrorMode = () => {
    const order = ['stop', 'continue', 'retry'] as const;
    const next = order[(order.indexOf(onErrorMode) + 1) % order.length];
    updateNodeData(nodeId, next === 'retry' && !data.retry ? { onError: next, retry: retryCfg } : { onError: next });
  };
  const errorModeMeta = {
    stop: { Icon: Ban, color: 'text-gray-500', label: 'On error: stop flow (click to change)' },
    continue: { Icon: ChevronsRight, color: 'text-amber-500', label: 'On error: continue flow (click to change)' },
    retry: { Icon: RotateCw, color: 'text-blue-500', label: 'On error: retry, then stop (click to change)' },
  }[onErrorMode];

  const handleEditFlowNode = async () => {
    const { navigateTo } = await openFlowNodeEditor({ id: nodeId, data }, sessionStore.activeSessionId);
    if (navigateTo) navigate(navigateTo);
  };

  // Re-point a flow node at a different sub-flow AFTER creation (issue 3):
  // opens the "Modify Flow Node" modal (same UI as Create Flow Node).
  const setRepointNodeId = useUIStore(s => s.setRepointNodeId);
  return (
    <div className="p-4 border-b border-gray-700 dark:border-gray-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">

          {(() => {
            switch (data.type) {
              case 'variable':
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
              case 'python':
                return <Code2 className="w-5 h-5 text-yellow-500 flex-shrink-0" />;
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
          {data.type !== 'variable' && data.type !== 'flow' && data.type !== 'goto' && (
            <button
              className="p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
              onClick={() => sessionStore.openNodeEditor(nodeId)}
            >
              <Edit2 className="w-4 h-4 text-blue-500" />
            </button>
          )}
          {data.type === 'flow' && (
            <button
              className="p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
              onClick={handleEditFlowNode}
              title={data.linkedSessionId ? "Switch to linked session" : "Create session from flow content"}
            >
              <Edit2 className="w-4 h-4 text-blue-500" />
            </button>
          )}
          {data.type === 'flow' && (
            <button
              className="p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
              onClick={() => setRepointNodeId(nodeId)}
              title="Modify flow node — re-point to another session or flow"
            >
              <Link2 className="w-4 h-4 text-emerald-500" />
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
          {data.type !== 'goto' && data.type !== 'comment' && data.type !== 'variable' && !isNodeExecuting && (
            <button
              className={`p-1 hover:bg-gray-400 dark:hover:bg-gray-700 rounded ${onErrorMode !== 'stop' ? 'bg-gray-400 dark:bg-gray-700' : ''}`}
              onClick={cycleErrorMode}
              title={errorModeMeta.label}
            >
              <errorModeMeta.Icon className={`w-4 h-4 ${errorModeMeta.color}`} />
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
      {/* Retry config row — only when the on-error policy is "retry" */}
      {onErrorMode === 'retry' && data.type !== 'goto' && (
        <div
          className="mt-2 flex items-center gap-2 text-xs text-black dark:text-white"
          onMouseEnter={() => { updateNodeDraggable(nodeId, false); updatePanOnDrag(false); }}
          onMouseLeave={() => { updateNodeDraggable(nodeId, true); updatePanOnDrag(true); }}
        >
          <RotateCw className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
          <label className="flex items-center gap-1">
            ×
            <input
              type="number" min={1}
              value={retryCfg.maxAttempts}
              onChange={(e) => updateNodeData(nodeId, { retry: { ...retryCfg, maxAttempts: Math.max(1, parseInt(e.target.value) || 1) } })}
              className="w-12 bg-gray-200 dark:bg-gray-700 border-none rounded px-1 py-0.5 font-mono"
              title="Total attempts (1 = no retry)"
            />
          </label>
          <label className="flex items-center gap-1">
            every
            <input
              type="number" min={0}
              value={retryCfg.delaySec}
              onChange={(e) => updateNodeData(nodeId, { retry: { ...retryCfg, delaySec: Math.max(0, parseInt(e.target.value) || 0) } })}
              className="w-12 bg-gray-200 dark:bg-gray-700 border-none rounded px-1 py-0.5 font-mono"
              title="Delay before each retry, in seconds"
            />s
          </label>
          <select
            value={retryCfg.backoff}
            onChange={(e) => updateNodeData(nodeId, { retry: { ...retryCfg, backoff: e.target.value as 'fixed' | 'linear' | 'exponential' } })}
            className="bg-gray-200 dark:bg-gray-700 border-none rounded px-1 py-0.5"
            title="Backoff: fixed (constant), linear (×attempt), exponential (×2^attempt)"
          >
            <option value="fixed">fixed</option>
            <option value="linear">linear</option>
            <option value="exponential">exponential</option>
          </select>
        </div>
      )}

      {/* Value input below title for variables */}
      {data.type === 'variable' && onValueChange && (
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
