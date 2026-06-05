import React, { useEffect, useState, useCallback } from 'react';
import { Server, RefreshCw, Trash2, Wifi, WifiOff, AlertTriangle, ChevronDown, ChevronRight, Edit2, Check, X, Lock, Shield } from 'lucide-react';
import { apiClient } from '../../utils/apiClient';
import { useAuth } from '../../hooks/useAuth';

type WorkerPlatform = 'win32' | 'linux' | 'darwin' | 'unknown';

interface WorkerAccess {
  mode: 'allow' | 'deny';
  roles: string[];
  users: string[];
}

// Human summary of a worker's access policy for the card meta line. Admins
// always have access and viewers never run flows, so only operator logins are
// meaningful — roles are not surfaced.
function accessSummary(access?: WorkerAccess | null): string {
  if (!access || (access.mode !== 'allow' && access.mode !== 'deny')) return 'everyone';
  const parts = [...(access.users || [])];
  const who = parts.length ? parts.join(', ') : '(nobody listed)';
  return access.mode === 'allow' ? `only ${who}` : `all except ${who}`;
}

// Inline allow/forbid policy editor. mode 'open' clears the policy (access=null).
// Only operator users are selectable: admins can always run, viewers never can,
// and operator is the only role for which access is a real decision.
const AccessEditor: React.FC<{
  access?: WorkerAccess | null;
  userLogins: string[];
  onSave: (access: WorkerAccess | null) => void;
  onCancel: () => void;
  title: string;
}> = ({ access, userLogins, onSave, onCancel, title }) => {
  const [mode, setMode] = useState<'open' | 'allow' | 'deny'>(access?.mode ?? 'open');
  const [users, setUsers] = useState<Set<string>>(new Set(access?.users ?? []));

  const toggle = (set: Set<string>, val: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    setter(next);
  };

  const save = () => {
    if (mode === 'open') { onSave(null); return; }
    onSave({ mode, roles: [], users: [...users] });
  };

  const forbidAllOperators = () => { setMode('deny'); setUsers(new Set(userLogins)); };

  // White-card chip styling — the editor renders on a white background, so
  // button text must stay dark for contrast.
  const chip = (active: boolean): React.CSSProperties => ({
    height: 24, padding: '0 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
    background: active ? '#2563eb' : '#fff',
    color: active ? '#fff' : '#1f2937',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  });

  return (
    <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6, padding: 12, marginTop: 8, color: '#1f2937' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Shield size={12} style={{ color: '#2563eb' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#374151' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {(['open', 'allow', 'deny'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={chip(mode === m)}>
            {m === 'open' ? 'Open to all' : m === 'allow' ? 'Allow only' : 'Forbid'}
          </button>
        ))}
        <button
          onClick={forbidAllOperators}
          style={{ ...chip(mode === 'deny' && userLogins.length > 0 && userLogins.every(u => users.has(u))), border: '1px solid #dc2626', color: (mode === 'deny' && userLogins.length > 0 && userLogins.every(u => users.has(u))) ? '#fff' : '#dc2626', background: (mode === 'deny' && userLogins.length > 0 && userLogins.every(u => users.has(u))) ? '#dc2626' : '#fff' }}
          title="Forbid every operator"
        >
          Forbid all operators
        </button>
      </div>
      {mode !== 'open' && (
        <div>
          <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'var(--font-mono)', marginBottom: 4, textTransform: 'uppercase' }}>Operators</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 96, overflowY: 'auto' }}>
            {userLogins.length === 0 && <span style={{ fontSize: 11, color: '#9ca3af' }}>no operators</span>}
            {userLogins.map(u => (
              <button key={u} onClick={() => toggle(users, u, setUsers)} style={chip(users.has(u))}>
                {users.has(u) ? <Check size={10} /> : null} {u}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={onCancel} style={chip(false)}>Cancel</button>
        <button onClick={save} style={chip(true)}>Save</button>
      </div>
    </div>
  );
};

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
  access?: WorkerAccess | null;
}

const WorkerCard: React.FC<{
  worker: RemoteWorker;
  removing: string | null;
  canDelete: boolean;
  isAdmin: boolean;
  userLogins: string[];
  onRemove: (id: string) => void;
  onGroupChange: (id: string, group: string) => void;
  onAccessChange: (id: string, access: WorkerAccess | null) => void;
}> = ({ worker: w, removing, canDelete, isAdmin, userLogins, onRemove, onGroupChange, onAccessChange }) => {
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupVal, setGroupVal] = useState(w.group || '');
  const [editingAccess, setEditingAccess] = useState(false);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="kv-label">// access</span>
            <span className="kv-val" style={{ fontFamily: 'var(--font-mono)', color: w.access ? 'var(--accent)' : 'var(--text-3)' }}>
              {accessSummary(w.access)}
            </span>
            {isAdmin && (
              <button onClick={() => setEditingAccess(v => !v)} title="Edit accessibility" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0 }}>
                <Lock size={10} />
              </button>
            )}
          </div>
        </div>
        {editingAccess && (
          <AccessEditor
            access={w.access}
            userLogins={userLogins}
            title={`Accessibility · ${w.name}`}
            onCancel={() => setEditingAccess(false)}
            onSave={(access) => { onAccessChange(w._id, access); setEditingAccess(false); }}
          />
        )}
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [userLogins, setUserLogins] = useState<string[]>([]);
  const [groupAccessKey, setGroupAccessKey] = useState<string | null>(null);
  const { canDeleteWorker, isAdmin } = useAuth();

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

  // Operator logins for the access-policy picker (admin only). Admins always
  // have access and viewers never run flows, so only operators are listed.
  useEffect(() => {
    if (!isAdmin) return;
    apiClient.get('/api/v1/users').then((data: any) => {
      const list = Array.isArray(data) ? data : [];
      setUserLogins(list.filter((u: any) => u.role === 'operator').map((u: any) => u.login).filter(Boolean));
    }).catch(() => { /* non-fatal */ });
  }, [isAdmin]);

  const handleAccessChange = async (id: string, access: WorkerAccess | null) => {
    try {
      await apiClient.patch(`/api/v1/workers/${id}`, { access });
      setWorkers(prev => prev.map(w => w._id === id ? { ...w, access } : w));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update access');
    }
  };

  const handleGroupAccess = async (groupKey: string, access: WorkerAccess | null) => {
    const seg = groupKey === '' ? '__ungrouped__' : encodeURIComponent(groupKey);
    try {
      await apiClient.patch(`/api/v1/workers/groups/${seg}/access`, { access });
      setGroupAccessKey(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update group access');
    }
  };

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
        </div>
      </div>

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
            <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-sans)' }}>
              The orchestrator runs flows locally by default. Connect remote workers to delegate execution.
            </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <button
                      onClick={() => toggleGroup(groupKey)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 0 }}
                    >
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      <span style={{ color: 'var(--accent)' }}>[{groupKey}]</span>
                      <span style={{ color: 'var(--text-3)' }}>{groupWorkers.length} worker{groupWorkers.length !== 1 ? 's' : ''}</span>
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => setGroupAccessKey(groupAccessKey === groupKey ? null : groupKey)}
                        className="tc-btn ghost"
                        style={{ height: 22, padding: '0 8px', fontSize: 11, gap: 4 }}
                        title="Set accessibility for all workers in this group"
                      >
                        <Shield size={11} /> Group access
                      </button>
                    )}
                  </div>
                )}
                {hasGroup && isAdmin && groupAccessKey === groupKey && (
                  <div style={{ marginBottom: 8, maxWidth: 420 }}>
                    <AccessEditor
                      access={groupWorkers[0]?.access}
                      userLogins={userLogins}
                      title={`Apply to all in [${groupKey}]`}
                      onCancel={() => setGroupAccessKey(null)}
                      onSave={(access) => handleGroupAccess(groupKey, access)}
                    />
                  </div>
                )}
                {!isCollapsed && (
                  <div className="flex flex-col gap-3">
                    {groupWorkers.map(w => (
                      <WorkerCard
                        key={w._id}
                        worker={w}
                        removing={removing}
                        canDelete={canDeleteWorker}
                        isAdmin={isAdmin}
                        userLogins={userLogins}
                        onRemove={handleRemove}
                        onGroupChange={handleGroupChange}
                        onAccessChange={handleAccessChange}
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
