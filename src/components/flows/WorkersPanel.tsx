import React, { useEffect, useState } from 'react';
import { Server, Plus, Pencil, Trash2, Wifi, WifiOff, Loader2, RefreshCw, AlertTriangle, Copy, Check } from 'lucide-react';
import { useWorkerStore } from '../../store/workerStore';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import AddWorkerModal from './AddWorkerModal';
import type { Worker } from '../../utils/workerApi';
import type { WorkerStatus } from '../../store/workerStore';

const STATUS_CONFIG: Record<WorkerStatus, { label: string; cls: string; spin?: boolean }> = {
  connected:    { label: 'Connected',    cls: 'ok' },
  disconnected: { label: 'Disconnected', cls: 'err' },
  checking:     { label: 'Checking…',    cls: 'running', spin: true },
  unknown:      { label: 'Unknown',      cls: 'idle' },
};

const WorkerCard: React.FC<{
  worker: Worker;
  status: WorkerStatus;
  flowCount: number;
  onEdit: () => void;
  onRemove: () => void;
  onCheck: () => void;
}> = ({ worker, status, flowCount, onEdit, onRemove, onCheck }) => {
  const cfg = STATUS_CONFIG[status];
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleCopyKey = () => {
    navigator.clipboard.writeText(worker.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="tc-worker-card">
      <div className="icon-block"><Server size={20} /></div>

      <div className="info">
        <div className="name-row">
          <span className="name">{worker.name}</span>
          <span className={`tc-status ${cfg.cls}`}>
            <span className="dot" />
            {cfg.label}
          </span>
        </div>

        <div className="url-row">
          <span>{worker.url}</span>
          {worker.apiKey && (
            <button className="copy-id" onClick={handleCopyKey} title="Copy API key">
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {worker.apiKey.slice(0, 8)}…
            </button>
          )}
          <span style={{ color: 'var(--text-mute)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            · {flowCount} flow{flowCount !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="meta">
          <div>
            <span className="kv-label">// status</span>
            <span className="kv-val">{cfg.label}</span>
          </div>
          <div>
            <span className="kv-label">// flows assigned</span>
            <span className="kv-val">{flowCount}</span>
          </div>
          <div>
            <span className="kv-label">// url</span>
            <span className="kv-val" style={{ fontFamily: 'var(--font-mono)' }}>{worker.url}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, alignSelf: 'flex-start' }}>
        <button className="tc-icon-btn" onClick={onCheck} title="Recheck connection">
          <RefreshCw size={13} className={status === 'checking' ? 'animate-spin' : ''} />
        </button>
        <button className="tc-icon-btn" onClick={onEdit} title="Edit worker">
          <Pencil size={13} />
        </button>
        <button
          className={`tc-icon-btn${confirmDelete ? ' danger' : ''}`}
          title={confirmDelete ? 'Confirm delete' : 'Remove worker'}
          onClick={() => {
            if (confirmDelete) { onRemove(); }
            else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
          }}
        >
          {confirmDelete ? <AlertTriangle size={13} /> : <Trash2 size={13} />}
        </button>
      </div>
    </div>
  );
};

const WorkersPanel: React.FC = () => {
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
  const connectedCount = workers.filter(w => statuses[w.id] === 'connected').length;

  return (
    <div className="tc-page">
      {/* Page header */}
      <div className="tc-page-header">
        <div className="tc-page-title">
          <h1>
            <span className="br">&lt;</span>
            <span className="name">Workers</span>
            <span className="slash"> /&gt;</span>
          </h1>
          <span className="subtitle">
            <span className="num">{workers.length}</span> backend{workers.length !== 1 ? 's' : ''} configured
            {' · '}
            <span className="num">{connectedCount}</span> connected
          </span>
        </div>
        <div className="tc-toolbar">
          <button className="tc-btn ghost" onClick={() => checkAllStatuses()} title="Refresh all">
            <RefreshCw size={13} />Refresh
          </button>
          <button className="tc-btn primary" onClick={() => setShowAdd(true)}>
            <Plus size={13} />Add Worker
          </button>
        </div>
      </div>

      {workers.length === 0 ? (
        <div className="tc-card">
          <div className="tc-empty" style={{ padding: '80px 20px' }}>
            <div style={{ marginBottom: 16 }}>
              <span className="tc-flow-icon" style={{ width: 48, height: 48, borderRadius: 12, display: 'inline-flex', margin: '0 auto 12px' }}>
                <Server size={22} />
              </span>
            </div>
            <div style={{ color: 'var(--text-2)', fontSize: 14, fontFamily: 'var(--font-sans)', fontWeight: 600, marginBottom: 6 }}>
              No workers configured
            </div>
            <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-sans)', marginBottom: 20 }}>
              Add a backend worker to start executing flows.
            </div>
            <button className="tc-btn primary" onClick={() => setShowAdd(true)}>
              <Plus size={13} />Add Your First Worker
            </button>
          </div>
        </div>
      ) : (
        <div>
          {workers.map(worker => (
            <WorkerCard
              key={worker.id}
              worker={worker}
              status={statuses[worker.id] ?? 'unknown'}
              flowCount={flowCountFor(worker.id)}
              onEdit={() => setEditWorker(worker)}
              onRemove={() => removeWorker(worker.id)}
              onCheck={() => checkStatus(worker.id)}
            />
          ))}
        </div>
      )}

      {showAdd && <AddWorkerModal onClose={() => setShowAdd(false)} />}
      {editWorker && <AddWorkerModal worker={editWorker} onClose={() => setEditWorker(null)} />}
    </div>
  );
};

export default WorkersPanel;
