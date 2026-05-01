import React, { useEffect, useState } from 'react';
import { Server, Plus, Pencil, Trash2, Wifi, WifiOff, Loader2, RefreshCw, AlertTriangle, Copy, Check } from 'lucide-react';
import { useWorkerStore } from '../../store/workerStore';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useTheme } from '../../context/ThemeContext';
import AddWorkerModal from './AddWorkerModal';
import type { Worker } from '../../utils/workerApi';
import type { WorkerStatus } from '../../store/workerStore';

const STATUS_CONFIG: Record<WorkerStatus, { label: string; icon: React.ElementType; classes: string; spin?: boolean }> = {
  connected: { label: 'Connected', icon: Wifi, classes: 'text-emerald-400' },
  disconnected: { label: 'Disconnected', icon: WifiOff, classes: 'text-red-400' },
  checking: { label: 'Checking…', icon: Loader2, classes: 'text-blue-400', spin: true },
  unknown: { label: 'Unknown', icon: Server, classes: 'text-gray-400' },
};

const WorkerCard: React.FC<{
  worker: Worker;
  status: WorkerStatus;
  flowCount: number;
  onEdit: () => void;
  onRemove: () => void;
  onCheck: () => void;
  dark: boolean;
}> = ({ worker, status, flowCount, onEdit, onRemove, onCheck, dark }) => {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleCopyKey = () => {
    navigator.clipboard.writeText(worker.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: worker.color + '22' }}>
          <Server className="w-5 h-5" style={{ color: worker.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm truncate">{worker.name}</span>
            <span className={`flex items-center gap-1 text-xs ${cfg.classes}`}>
              <Icon className={`w-3 h-3 ${cfg.spin ? 'animate-spin' : ''}`} />
              {cfg.label}
            </span>
          </div>
          <p className={`text-xs font-mono truncate mb-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{worker.url}</p>
          <div className="flex items-center gap-3 text-xs">
            <div className={`flex items-center gap-1 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
              <span className="font-mono">{worker.apiKey ? worker.apiKey.slice(0, 8) + '…' : '(no key)'}</span>
              {worker.apiKey && (
                <button onClick={handleCopyKey} className="hover:text-purple-400 transition-colors">
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
            </div>
            <span className={dark ? 'text-gray-600' : 'text-gray-400'}>{flowCount} flow{flowCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onCheck} title="Check connection" className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-800 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}>
            <RefreshCw className={`w-3.5 h-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onEdit} title="Edit worker" className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-800 text-gray-500 hover:text-blue-400' : 'hover:bg-gray-100 text-gray-400 hover:text-blue-600'}`}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { if (confirmDelete) { onRemove(); } else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); } }}
            title={confirmDelete ? 'Confirm delete' : 'Remove worker'}
            className={`p-1.5 rounded-md ${confirmDelete ? 'bg-red-500/20 text-red-400' : dark ? 'hover:bg-gray-800 text-gray-500 hover:text-red-400' : 'hover:bg-gray-100 text-gray-400 hover:text-red-500'}`}
          >
            {confirmDelete ? <AlertTriangle className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <div className={`mt-3 pt-3 border-t grid grid-cols-3 gap-3 text-xs ${dark ? 'border-gray-800 text-gray-500' : 'border-gray-100 text-gray-400'}`}>
        <div><p className="font-medium mb-0.5">URL</p><p className={`font-mono truncate ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{worker.url}</p></div>
        <div><p className="font-medium mb-0.5">Status</p><p className={cfg.classes}>{cfg.label}</p></div>
        <div><p className="font-medium mb-0.5">Flows</p><p className={dark ? 'text-gray-300' : 'text-gray-700'}>{flowCount} assigned</p></div>
      </div>
    </div>
  );
};

const WorkersPanel: React.FC = () => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { workers, statuses, removeWorker, checkStatus, checkAllStatuses } = useWorkerStore();
  const { flows } = useFlowLibraryStore();
  const [showAdd, setShowAdd] = useState(false);
  const [editWorker, setEditWorker] = useState<Worker | null>(null);

  useEffect(() => {
    checkAllStatuses();
    const interval = setInterval(() => checkAllStatuses(), 30_000);
    return () => clearInterval(interval);
  }, [workers.length]);

  const flowCountFor = (workerId: string) => flows.filter(f => f.workerId === workerId).length;

  return (
    <div className={`h-full flex flex-col ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div className={`px-6 py-4 border-b flex items-center justify-between flex-shrink-0 ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        <div>
          <h1 className="text-lg font-semibold">Workers</h1>
          <p className={`text-xs mt-0.5 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
            {workers.length} backend{workers.length !== 1 ? 's' : ''} configured · {workers.filter(w => statuses[w.id] === 'connected').length} connected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => checkAllStatuses()} className={`p-2 rounded-lg ${dark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`} title="Refresh all">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium">
            <Plus className="w-4 h-4" />Add Worker
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {workers.length === 0 ? (
          <div className={`rounded-xl border py-20 flex flex-col items-center gap-4 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
            <div className="w-14 h-14 rounded-xl bg-purple-600/10 flex items-center justify-center">
              <Server className="w-7 h-7 text-purple-400" />
            </div>
            <div className="text-center">
              <p className="font-semibold">No workers configured</p>
              <p className={`text-sm mt-1 max-w-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                Add a backend worker to start executing flows. Each worker is an Orchestrator backend instance.
              </p>
            </div>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium">
              <Plus className="w-4 h-4" />Add Your First Worker
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {workers.map(worker => (
              <WorkerCard
                key={worker.id}
                worker={worker}
                status={statuses[worker.id] ?? 'unknown'}
                flowCount={flowCountFor(worker.id)}
                onEdit={() => setEditWorker(worker)}
                onRemove={() => removeWorker(worker.id)}
                onCheck={() => checkStatus(worker.id)}
                dark={dark}
              />
            ))}
          </div>
        )}
      </div>
      {showAdd && <AddWorkerModal onClose={() => setShowAdd(false)} />}
      {editWorker && <AddWorkerModal worker={editWorker} onClose={() => setEditWorker(null)} />}
    </div>
  );
};

export default WorkersPanel;
