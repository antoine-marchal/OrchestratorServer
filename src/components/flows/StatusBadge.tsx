import React from 'react';
import type { ExecutionStatus } from '../../utils/workerApi';

const STATUS_MAP: Record<ExecutionStatus, { label: string; cls: string }> = {
  SUCCESS: { label: 'Success', cls: 'ok' },
  FAILED:  { label: 'Failed',  cls: 'err' },
  RUNNING: { label: 'Running', cls: 'running' },
  KILLED:  { label: 'Killed',  cls: 'err' },
  QUEUED:  { label: 'Queued',  cls: 'idle' },
};

interface StatusBadgeProps {
  status: ExecutionStatus;
  size?: 'sm' | 'md';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.QUEUED;
  return (
    <span className={`tc-status ${cfg.cls}`}>
      <span className="dot" />
      {cfg.label}
    </span>
  );
};

export default StatusBadge;
