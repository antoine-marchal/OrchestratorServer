import React from 'react';

interface ToolbarButtonProps {
  onClick: () => void;
  icon: React.ElementType<{ className?: string }>;
  label: string;
  color: string; // Tailwind color classes, e.g. "bg-blue-500 hover:bg-blue-600"
  title?: string;
  disabled?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  icon: Icon,
  label,
  color,
  title,
  disabled = false
}) => (
  <button
    onClick={onClick}
    className={`group flex items-center w-10 h-10 ${color} text-white rounded-lg hover:w-32 transition-all duration-200 overflow-hidden px-2 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    title={title || label}
    type="button"
    disabled={disabled}
    aria-label={label}
  >
    <Icon className="w-5 h-5 flex-shrink-0" />
    <span className="ml-2 max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 transition-all duration-200 whitespace-nowrap overflow-hidden">
      {label}
    </span>
  </button>
);

export default ToolbarButton;
