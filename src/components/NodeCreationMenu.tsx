import React from 'react';
import { NODE_TYPES } from '../constants/nodeTypes';

interface NodeCreationMenuProps {
  onAddNode: (type: string, position?: { x: number; y: number }) => void;
  position?: { x: number; y: number };
  flowPosition?: { x: number; y: number };
  type: 'dropdown' | 'context';
}

const NodeCreationMenu: React.FC<NodeCreationMenuProps> = ({ onAddNode, position, flowPosition, type }) => {
  const isContextMenu = type === 'context';

  return (
    <div
      className="absolute right-0 mt-2 w-48
        bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700
        rounded-lg shadow-2xl py-2 z-50"
      style={
        isContextMenu && position
          ? {
              position: 'fixed',
              left: position.x,
              top: position.y,
              right: 'auto',
              pointerEvents: 'auto',
            }
          : undefined
      }
      onClick={(e) => isContextMenu && e.stopPropagation()}
    >
      {NODE_TYPES.map((nodeType) => (
        <button
          key={nodeType.id}
          className="w-full text-left px-4 py-2
            text-gray-800 dark:text-gray-100
            hover:bg-gray-100 dark:hover:bg-gray-700
            focus:bg-gray-200 dark:focus:bg-gray-600
            transition-colors flex items-center gap-2"
          onClick={() => onAddNode(nodeType.id, isContextMenu ? flowPosition : undefined)}
        >
          {nodeType.icon && React.createElement(nodeType.icon, {
            className: `w-4 h-4 ${nodeType.iconColor}`,
          })}
          {nodeType.label}
        </button>
      ))}
    </div>
  );
};

export default NodeCreationMenu;
