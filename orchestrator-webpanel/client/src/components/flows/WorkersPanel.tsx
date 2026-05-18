import React, { useEffect, useState, useCallback } from 'react';
import { Server, RefreshCw, Trash2, Wifi, WifiOff, Terminal, AlertTriangle, ChevronDown, ChevronRight, Edit2, Check, X } from 'lucide-react';
import { apiClient } from '../../utils/apiClient';
import { useAuth } from '../../hooks/useAuth';

type WorkerPlatform = 'win32' | 'linux' | 'darwin' | 'unknown';

const PLATFORM_LABEL: Record<WorkerPlatform, string> = {
  win32: 'Windows',
  linux: 'Linux',
  darwin: 'macOS',
  unknown: 'Unknown',
};

const PLATFORM_COLOR: Record<WorkerPlatform, string> = {
  win32: 'var(--accent)',
  linux: 'var(--ok)',
  darwin: 'var(--text-2)',
  unknown: 'var(--text-3)',
};

interface RemoteWorker {
  _id: string;
  name: string;
  platform: WorkerPlatform;
  status: 'online' | 'offline';
  lastSeenAt: string;
  registeredAt: string;
  assignedUserId?: string;
  group?: string;
}

const WorkerCard: React.FC<{
  worker: RemoteWorker;
  removing: string | null;
  canDelete: boolean;
  onRemove: (id: string) => void;
  onGroupChange: (id: string, group: string) => void;
}> = ({ worker: w, removing, canDelete, onRemove, onGroupChange }) => {
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupVal, setGroupVal] = useState(w.group || '');

  const saveGroup = () => {
    onGroupChange(w._id, groupVal.trim());
    setEditingGroup(false);
  };

  return (
    <div className="tc-worker-card">
      <div className="icon-block">
        {w.status === 'online'
          ? <Wifi size={20} style={{ color: 'var(--ok)' }} />
          : <WifiOff size={20} style={{ color: 'var(--text-3)' }} />}
      </div>

      <div className="info">
        <div className="name-row">
          <span className="name">{w.name}</span>
          <span className={`tc-status ${w.status === 'online' ? 'ok' : 'err'}`}>
            <span className="dot" />
            {w.status === 'online' ? 'Online' : 'Offline'}
          </span>
        </div>

        <div className="url-row">
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
            Last seen: {w.lastSeenAt ? new Date(w.lastSeenAt).toLocaleString() : '—'}
          </span>
        </div>

        <div className="meta">
          <div>
            <span className="kv-label">// registered</span>
            <span className="kv-val">{new Date(w.registeredAt).toLocaleDateString()}</span>
          </div>
          <div>
            <span className="kv-label">// platform</span>
            <span className="kv-val" style={{ color: PLATFORM_COLOR[w.platform ?? 'unknown'], fontFamily: 'var(--font-mono)' }}>
              {PLATFORM_LABEL[w.platform ?? 'unknown']}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="kv-label">// group</span>
            {editingGroup ? (
              <>
                <input
                  autoFocus
                  value={groupVal}
                  onChange={e => setGroupVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveGroup(); if (e.key === 'Escape') setEditingGroup(false); }}
                  style={{ background: 'var(--bg-3)', border: '1px solid var(--accent)', borderRadius: 3, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '1px 4px', width: 100 }}
                />
                <button onClick={saveGroup} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ok)', padding: 0 }}><Check size={11} /></button>
                <button onClick={() => setEditingGroup(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0 }}><X size={11} /></button>
              </>
            ) : (
              <>
                <span className="kv-val" style={{ fontFamily: 'var(--font-mono)' }}>{w.group || '—'}</span>
                {canDelete && (
                  <button onClick={() => { setGroupVal(w.group || ''); setEditingGroup(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0 }}>
                    <Edit2 size={10} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {canDelete && (
        <div style={{ display: 'flex', gap: 4, alignSelf: 'flex-start' }}>
          <button
            className="tc-icon-btn"
            title="Remove worker record"
            disabled={removing === w._id}
            onClick={() => onRemove(w._id)}
          >
            <Trash2 size={13} style={{ color: 'var(--err)' }} />
          </button>
        </div>
      )}
    </div>
  );
};

const WorkersPanel: React.FC = () => {
  const [workers, setWorkers] = useState<RemoteWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { canDeleteWorker } = useAuth();

  const load = useCallback(async () => {
    try {
      const data: any = await apiClient.get('/api/v1/workers');
      setWorkers(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load workers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRemove = async (id: string) => {
    setRemoving(id);
    try {
      await apiClient.delete(`/api/v1/workers/${id}/record`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to remove worker');
    } finally {
      setRemoving(null);
    }
  };

  const handleGroupChange = async (id: string, group: string) => {
    try {
      await apiClient.patch(`/api/v1/workers/${id}`, { group: group || null });
      setWorkers(prev => prev.map(w => w._id === id ? { ...w, group: group || undefined } : w));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update group');
    }
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // Group workers: ungrouped workers go under '' key
  const grouped: Record<string, RemoteWorker[]> = {};
  for (const w of workers) {
    const key = w.group || '';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(w);
  }
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  const onlineCount = workers.filter(w => w.status === 'online').length;
  const serverUrl = window.location.origin;

  return (
    <div className="tc-page">
      <div className="tc-page-header">
        <div className="tc-page-title">
          <h1>
            <span className="br">&lt;</span>
            <span className="name">Workers</span>
            <span className="slash"> /&gt;</span>
          </h1>
          <span className="subtitle">
            <span className="num">{workers.length}</span> registered
            {' · '}
            <span className="num">{onlineCount}</span> online
          </span>
        </div>
        <div className="tc-toolbar">
          <button className="tc-btn ghost" onClick={load} title="Refresh">
            <RefreshCw size={13} /> Refresh
          </button>
          <button className="tc-btn primary" onClick={() => setShowConnect(v => !v)}>
            <Terminal size={13} /> How to connect
          </button>
        </div>
      </div>

      {showConnect && (
        <div className="tc-card" style={{ marginBottom: 16, padding: 16 }}>
          <div className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            Connect a remote worker
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-2)' }}>
            Workers self-register. Run the agent on any machine and point it at this orchestrator.
          </p>
          <pre className="text-xs p-3 rounded" style={{ background: 'var(--bg-3)', color: 'var(--accent)', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
{`# Set env vars and start the worker agent
ORCHESTRATOR_URL=${serverUrl}
WORKER_NAME=my-worker-1
# optional: WORKER_REGISTRATION_SECRET=<same as server env>
# optional: ORCHESTRATOR_EXECUTION_DIR=/path/to/workdir

npm start   # in orchestrator-worker/`}
          </pre>
          <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
            The worker appears here automatically within a few seconds of starting.
            Assign it to a flow in the flow's settings tab.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded text-xs mb-4"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--err)' }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {loading && workers.length === 0 ? (
        <div className="tc-card">
          <div className="tc-empty" style={{ padding: '60px 20px' }}>
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
          </div>
        </div>
      ) : workers.length === 0 ? (
        <div className="tc-card">
          <div className="tc-empty" style={{ padding: '80px 20px' }}>
            <span className="tc-flow-icon" style={{ width: 48, height: 48, borderRadius: 12, display: 'inline-flex', margin: '0 auto 12px' }}>
              <Server size={22} />
            </span>
            <div style={{ color: 'var(--text-2)', fontSize: 14, fontFamily: 'var(--font-sans)', fontWeight: 600, marginBottom: 6 }}>
              No workers connected
            </div>
            <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-sans)', marginBottom: 20 }}>
              The orchestrator runs flows locally by default. Connect remote workers to delegate execution.
            </div>
            <button className="tc-btn primary" onClick={() => setShowConnect(true)}>
              <Terminal size={13} /> How to connect
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groupKeys.map(groupKey => {
            const groupWorkers = grouped[groupKey];
            const isCollapsed = collapsedGroups.has(groupKey);
            const hasGroup = groupKey !== '';
            return (
              <div key={groupKey || '__ungrouped__'}>
                {hasGroup && (
                  <button
                    onClick={() => toggleGroup(groupKey)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 6, padding: 0 }}
                  >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <span style={{ color: 'var(--accent)' }}>[{groupKey}]</span>
                    <span style={{ color: 'var(--text-3)' }}>{groupWorkers.length} worker{groupWorkers.length !== 1 ? 's' : ''}</span>
                  </button>
                )}
                {!isCollapsed && (
                  <div className="flex flex-col gap-3">
                    {groupWorkers.map(w => (
                      <WorkerCard
                        key={w._id}
                        worker={w}
                        removing={removing}
                        canDelete={canDeleteWorker}
                        onRemove={handleRemove}
                        onGroupChange={handleGroupChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WorkersPanel;
