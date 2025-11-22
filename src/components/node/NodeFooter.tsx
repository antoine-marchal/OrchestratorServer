import React from 'react';
import { Handle, Position } from 'reactflow';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { EdgeConnection } from '../../types/node';
import { useFlowStore } from '../../store/flowStore';

interface NodeFooterProps {
  nodeId: string;
  isEditing: boolean;
  setConnecting: React.Dispatch<React.SetStateAction<boolean>>;
  type: 'constant' | string;
  inputEdges: EdgeConnection[];
  outputEdges: EdgeConnection[];
  getNodeLabel: (id: string) => string;
}

export const NodeFooter: React.FC<NodeFooterProps> = ({
  nodeId,
  type,
  inputEdges,
  outputEdges,
  setConnecting,
  getNodeLabel
}) => {
  const { moveConnection,removeConnection,updateNodeDraggable } = useFlowStore();

  const ConnectionList = ({ 
    edges, 
    type, 
    align 
  }: { 
    edges: EdgeConnection[], 
    type: 'input' | 'output',
    align: 'left' | 'right'
  }) => (
    <div className="space-y-1">
      {edges.map((edge, index) => (
        <div 
          key={edge.id} 
          className={`flex items-center gap-1 py-0.5 ${
            align === 'right' ? 'justify-end' : ''
          }`}
          
        >
          {align === 'left' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeConnection(edge.id);
                }}
                className="p-0.5 hover:bg-gray-400 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-3 h-3 text-red-400" />
              </button>
              <div className="flex flex-col">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveConnection(nodeId, type, edge.id, 'up');
                  }}
                  disabled={index === 0}
                  className={`p-0.5 rounded ${
                    index === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-400 dark:hover:bg-gray-700'
                  }`}
                >
                  <ChevronUp className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveConnection(nodeId, type, edge.id, 'down');
                  }}
                  disabled={index === edges.length - 1}
                  className={`p-0.5 rounded ${
                    index === edges.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-400 dark:hover:bg-gray-700'
                  }`}
                >
                  <ChevronDown className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            </>
          )}
          <span className="text-[10px] text-gray-600 dark:text-gray-400">
            {type === 'input' ? 'From ' : 'To '}
            {getNodeLabel(type === 'input' ? edge.source : edge.target)}
          </span>
          {align === 'right' && (
            <>
            
 
              <button type="button" style={{ zIndex: 10, position: "relative", pointerEvents: "auto" }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeConnection(edge.id);
                }}
                className="p-0.5 hover:bg-gray-400 dark:hover:bg-gray-700 rounded z-50 relative"
              >
                <X className="w-3 h-3 text-red-400" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );

  return (

    <div className="p-4 " 
    onMouseEnter={() => {
      updateNodeDraggable(nodeId, false);
      setConnecting(true)
    }} 
    onMouseLeave={() => {
      updateNodeDraggable(nodeId, true);
      setConnecting(false)
      }}>
      
      <div className="flex justify-between">
        <div className="w-1/2 pr-2">
          {type !== 'constant' && (
            <div className="relative">
              <Handle
                type="target"
                position={Position.Left}
                className={`w-3 h-3 !bg-blue-500`}
                style={{ zIndex: 1 }}
              />
              <div className="ml-6"  >
                <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
                  Inputs
                </span>
                <ConnectionList 
                  edges={inputEdges} 
                  type="input" 
                  align="left"
                />
              </div>
            </div>
          )}
        </div>
        <div className="w-1/2 pl-2">
          <div className="relative">
            <Handle
              type="source"
              position={Position.Right}
              className={`w-3 h-3 !bg-green-500`}
              style={{ zIndex: 1 }}
            />
            <div className="mr-6 text-right">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
                Outputs
              </span>
              <ConnectionList 
                edges={outputEdges} 
                type="output" 
                align="right"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};