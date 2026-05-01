import React from 'react';
import { CheckCircle2, XCircle, Loader2, StopCircle, Clock } from 'lucide-react';
import type { ExecutionStatus } from '../../utils/workerApi';

const STATUS_CONFIG: Record<ExecutionStatus, { label: string; icon: React.ElementType; classes: string; spin?: boolean }> = {
  SUCCESS: { label: 'Success', icon: CheckCircle2, classes: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  FAILED: { label: 'Failed', icon: XCircle, classes: 'text-red-400 bg-red-400/10 border-red-400/20' },
  RUNNING: { label: 'Running', icon: Loader2, classes: 'text-blue-400 bg-blue-400/10 border-blue-400/20', spin: true },
  KILLED: { label: 'Killed', icon: StopCircle, classes: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  QUEUED: { label: 'Queued', icon: Clock, classes: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
};

interface StatusBadgeProps {
  status: ExecutionStatus;
  size?: 'sm' | 'md';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.QUEUED;
  const Icon = cfg.icon;
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const padding = size === 'sm' ? 'px-1.5 py-0.5 gap-1' : 'px-2 py-1 gap-1.5';

  return (
    <span className={`inline-flex items-center ${padding} rounded border font-medium text-xs ${cfg.classes}`}>
      <Icon className={`${iconSize} ${cfg.spin ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
};

export default StatusBadge;
