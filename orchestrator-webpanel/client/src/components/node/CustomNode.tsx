import React, { memo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NodeResizer, NodeProps } from 'reactflow';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useSessionStore } from '../../store/sessionStore';
import { openFlowNodeEditor } from '../../store/flowNodeContent';
import { NodeHeader } from './NodeHeader';
import { NodeBody } from './NodeBody';
import { NodeFooter } from './NodeFooter';
import { Loader2, ExternalLink } from 'lucide-react';

const CustomNode = ({ data, id, selected }: NodeProps) => {
  const { updateNodeData,updateCodeFilePath, executeNode, edges, removeNode, nodes, nodeLoading, stopNodeExecution, outputClearCounter } = useFlowStore();
  const sessionStore = useSessionStore();
  const navigate = useNavigate();
  const isLoading = nodeLoading?.[id];

  const handleFlowNodeDoubleClick = async (e: React.MouseEvent) => {
    if (data.type !== 'flow') return;
    e.stopPropagation();
    const { navigateTo } = await openFlowNodeEditor({ id, data }, sessionStore.activeSessionId);
    if (navigateTo) navigate(navigateTo);
  };
  
  const [expanded, setExpanded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  
  const getNodeLabel = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    return node?.data?.label || nodeId;
  };

  const inputEdges = edges.filter(edge => edge.target === id);
  const outputEdges = edges.filter(edge => edge.source === id);
  const contentRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState(148);
  const [maxHeight, setMaxHeight] = useState(10000);

  // 🔁 Use ResizeObserver for accurate and performant height tracking
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const height = entry.contentRect.height;
      setMinHeight(height);
      setMaxHeight(height);
    });

    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);
  useEffect(() => {
    // À chaque clearAllOutputs, on recalcule la taille minimale/naturelle
    const element = contentRef.current;
    if (element) {
      // Forcer la taille naturelle après clear
      const newHeight = element.getBoundingClientRect().height;
      setMinHeight(newHeight);
      setMaxHeight(newHeight);
    }
  }, [outputClearCounter]);
  return (
    <div
      className={`relative ${data.type === 'flow' ? 'bg-emerald-300 dark:bg-emerald-900' : 'bg-gray-300 dark:bg-gray-800'} rounded-lg ${
        selected
          ? data.type === 'flow'
            ? 'ring-2 ring-emerald-500'
            : 'ring-2 ring-blue-500'
          : ''
      }`}
      onDoubleClick={data.type === 'flow' ? handleFlowNodeDoubleClick : undefined}
    >
      {/* External file indicator */}
      {data.codeFilePath && (
        <div className="absolute -top-2 -right-2 bg-blue-600 rounded-full p-1 z-20 shadow-md" title={`External file: ${data.codeFilePath}`}>
          <ExternalLink className="w-3 h-3 text-white" />
        </div>
      )}
      <div
        ref={contentRef}
        className={`flex flex-col transition-[height] duration-200 'opacity-50  select-none'`}
      >
        <NodeResizer
          color="#00000000"
          isVisible={selected}
          minWidth={200}
          minHeight={minHeight}
          maxHeight={maxHeight}
        />

        <NodeHeader
          data={data}
          nodeId={id}
          onLabelChange={(label) => {
            updateNodeData(id, { label });
            
          }}
          onValueChange={(value) => updateNodeData(id, { value })}
          onExecute={() => executeNode(id)}
          onDelete={() => removeNode(id)}
        />

        <NodeBody
          data={data}
          nodeId={id}
          isEditing={false}
          onCodeChange={(value) => value && updateNodeData(id, { code: value })}
          setExpanded={setExpanded}
          expanded={expanded}
        />

        <NodeFooter
          nodeId={id}
          type={data.type}
          inputEdges={inputEdges}
          outputEdges={outputEdges}
          getNodeLabel={getNodeLabel}
          isEditing={false}
          setConnecting={setConnecting}
        />
      </div>

      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg pointer-events-none z-10"
        >
          <Loader2 className="text-blue-400 animate-spin w-10 h-10" />
        </div>
      )}
    </div>
  );
};

export default memo(CustomNode);
