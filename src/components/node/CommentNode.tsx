import React, { memo, useRef, useLayoutEffect, useState, useEffect } from 'react';
import { NodeResizer, NodeProps } from 'reactflow';
import { Trash2 } from 'lucide-react';
import { useFlowStore } from '../../store/sessionFlowStore';

const MIN_HEIGHT = 64;

const CommentNode = ({ data, id, selected }: NodeProps) => {
  const { removeNode, updateNodeData, updateNodeDraggable, updatePanOnDrag } = useFlowStore();
  const [editing, setEditing] = useState(false);
// Handle DEL key for deletion when node is selected
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selected && e.key === 'Delete' && !editing) {
        e.preventDefault();
        removeNode(id);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selected, id, editing, removeNode]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeNode(id);
  };

  return (
    <div
      className="relative border border-yellow-400 bg-yellow-100/80 dark:bg-yellow-800/70 rounded-lg shadow-md group"
      style={{
        minWidth: 180,
        minHeight: MIN_HEIGHT,
        width: 'auto',
        boxShadow: '0 0 0 2px #fde68a30',
        display: 'flex',
        flexDirection: 'column',
        height: '100%', // allow resizer to set height
      }}
    >
      <NodeResizer
        color="#eab308"
        isVisible={selected}
        minWidth={180}
        minHeight={MIN_HEIGHT}
        handleStyle={{
          zIndex: 20,
        }}
      />

      {/* Delete button - visible when selected or on hover */}
      <button
        onClick={handleDelete}
        className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 z-30 shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ opacity: selected ? 1 : undefined }}
        title="Delete comment"
      >
        <Trash2 className="w-3 h-3" />
      </button>
  
      {/* FLEX-1 makes this fill the remaining space */}
      <div className="flex-1 flex flex-col py-4 pb-3">
        <textarea
          className="w-full h-full flex-1 bg-transparent text-yellow-900 dark:text-yellow-100 font-medium resize-none border-none focus:ring-0 focus:outline-none"
          placeholder="Add your comment…"
          value={data.value || ''}
          onChange={e => updateNodeData(id, { value: e.target.value })}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onMouseEnter={() => { updateNodeDraggable(id, false); updatePanOnDrag(false); }}
          onMouseLeave={() => { if (!editing) { updateNodeDraggable(id, true); updatePanOnDrag(true); } }}
          rows={1}
          style={{
            minHeight: '10px',
            height: '100%',
            maxHeight: '100%',
            textAlign : 'center'
          }}
        />
      </div>
    </div>
  );
};

export default memo(CommentNode);
