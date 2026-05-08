import React from 'react';
import { Copy } from 'lucide-react';

interface ExecIdCellProps {
  id: string;
  big?: boolean;
}

const ExecIdCell: React.FC<ExecIdCellProps> = ({ id, big = false }) => {
  const m = id.match(/^(\d{8})(\d{6})_(.+)$/);
  const style = big ? { fontSize: 17 } : undefined;

  if (!m) {
    return (
      <span className="tc-exec-id" style={style}>
        <span className="hash">{id}</span>
      </span>
    );
  }

  const [, date, time, suffix] = m;

  return (
    <span className="tc-exec-id" style={style}>
      <span className="ts">{date}</span>
      <span className="sep">·</span>
      <span className="ts">{time}</span>
      <span className="sep">_</span>
      <span className="hash">{suffix}</span>
      <button
        className="copy-btn"
        title="Copy execution ID"
        onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(id); }}
      >
        <Copy size={11} />
      </button>
    </span>
  );
};

export default ExecIdCell;
