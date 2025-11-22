import React from 'react';
import { Handle, Position } from 'reactflow';
import { GripVertical, X } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { ConnectionItemProps, EdgeConnection } from '../../types/node';

const SortableConnectionItem: React.FC<ConnectionItemProps> = ({ id, label, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="flex items-center gap-2 py-1">
      <GripVertical className="w-3 h-3 text-gray-400 cursor-grab" />
      <span className="text-xs text-gray-400">{label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="p-1 hover:bg-gray-700 rounded"
      >
        <X className="w-3 h-3 text-red-400" />
      </button>
    </div>
  );
};

interface NodeConnectionsProps {
  type: 'input' | 'output';
  edges: EdgeConnection[];
  nodeId: string;
  getNodeLabel: (id: string) => string;
  onRemoveConnection: (id: string) => void;
  onReorder: (oldId: string, newId: string) => void;
}

export const NodeConnections: React.FC<NodeConnectionsProps> = ({
  type,
  edges,
  nodeId,
  getNodeLabel,
  onRemoveConnection,
  onReorder,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      onReorder(active.id, over.id);
    }
  };

  return (
    <div className="relative">
      <Handle
        type={type === 'input' ? 'target' : 'source'}
        position={type === 'input' ? Position.Left : Position.Right}
        className={`w-3 h-3 ${type === 'input' ? '!bg-blue-500' : '!bg-green-500'}`}
      />
      <div className={type === 'input' ? 'ml-6' : 'mr-6 text-right'}>
        <span className="text-xs text-gray-400">{type === 'input' ? 'Inputs:' : 'Outputs:'}</span>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={edges.map(e => e.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1">
              {edges.map(edge => (
                <SortableConnectionItem
                  key={edge.id}
                  id={edge.id}
                  label={`${type === 'input' ? 'From' : 'To'} ${getNodeLabel(type === 'input' ? edge.source : edge.target)}`}
                  onRemove={() => onRemoveConnection(edge.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};