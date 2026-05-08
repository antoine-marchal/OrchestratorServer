import React, { useEffect, useState, useCallback } from 'react';
import {
  Users, Lock, Plus, Trash2, Key, Copy, Check,
  Eye, EyeOff, ChevronDown, ChevronRight,
  AlertCircle, Search, ShieldCheck, RefreshCw,
} from 'lucide-react';
import { apiClient } from '../../utils/apiClient';

/* ─── Types ─────────────────────────────────────────── */

interface ApiKey {
  id: string;
  label: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

interface User {
  _id: string;
  email: string;
  role: string;
  createdAt: string;
  apiKeys: ApiKey[];
}

interface Secret {
  _id: string;
  name: string;
  scope: 'global' | 'flow';
  flowId?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

type AdminTab = 'users' | 'secrets';

/* ─── Raw key modal ──────────────────────────────────── */

function RawKeyModal({ rawKey, onClose }: { rawKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-lg p-6 w-full max-w-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>API Key Created</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--err)' }}>
          This key will not be shown again. Copy and store it securely.
        </p>
        <div className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)' }}>
          <code className="text-xs flex-1 truncate" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{rawKey}</code>
          <button onClick={copy} className="tc-btn ghost" style={{ height: 24, padding: '0 8px', gap: 4, fontSize: 11 }}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="tc-btn" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Role badge ─────────────────────────────────────── */

const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--accent)',
  operator: 'var(--ok)',
  viewer: 'var(--text-3)',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 4,
      background: 'var(--surface-hi)', border: '1px solid var(--border)',
      fontFamily: 'var(--font-mono)', fontSize: 11,
      color: ROLE_COLORS[role] ?? 'var(--text-3)',
    }}>
      {role}
    </span>
  );
}

/* ─── Main component ─────────────────────────────────── */

export const AdminLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  /* ── Users state ── */
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [showPwd, setShowPwd] = useState(false);
  const [keyUserId, setKeyUserId] = useState<string | null>(null);
  const [keyLabel, setKeyLabel] = useState('');
  const [userSearch, setUserSearch] = useState('');

  /* ── Secrets state ── */
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(true);
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [showCreateSecret, setShowCreateSecret] = useState(false);
  const [secName, setSecName] = useState('');
  const [secValue, setSecValue] = useState('');
  const [secScope, setSecScope] = useState<'global' | 'flow'>('global');
  const [secFlowId, setSecFlowId] = useState('');
  const [secretSearch, setSecretSearch] = useState('');

  /* ── Loaders ── */
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const data = await apiClient.get('/api/v1/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setUsersError(e?.message ?? 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadSecrets = useCallback(async () => {
    setSecretsLoading(true);
    setSecretsError(null);
    try {
      const data = await apiClient.get('/api/v1/secrets');
      setSecrets(Array.isArray(data) ? data : data.secrets ?? []);
    } catch (e: any) {
      setSecretsError(e?.message ?? 'Failed to load secrets');
    } finally {
      setSecretsLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); loadSecrets(); }, [loadUsers, loadSecrets]);

  /* ── User actions ── */
  const handleCreateUser = async () => {
    try {
      await apiClient.post('/api/v1/users', { email: newEmail, password: newPassword, role: newRole });
      setShowCreateUser(false);
      setNewEmail(''); setNewPassword(''); setNewRole('operator');
      await loadUsers();
    } catch (e: any) { setUsersError(e?.message ?? 'Failed to create user'); }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await apiClient.delete(`/api/v1/users/${id}`);
      await loadUsers();
    } catch (e: any) { setUsersError(e?.message ?? 'Failed to delete user'); }
  };

  const handleCreateKey = async (userId: string) => {
    if (!keyLabel.trim()) return;
    try {
      const result: any = await apiClient.post(`/api/v1/users/${userId}/apikeys`, { label: keyLabel });
      setRawKey(result.rawKey);
      setKeyUserId(null); setKeyLabel('');
      await loadUsers();
    } catch (e: any) { setUsersError(e?.message ?? 'Failed to create API key'); }
  };

  const handleRevokeKey = async (userId: string, keyId: string) => {
    try {
      await apiClient.delete(`/api/v1/users/${userId}/apikeys/${keyId}`);
      await loadUsers();
    } catch (e: any) { setUsersError(e?.message ?? 'Failed to revoke key'); }
  };

  /* ── Secret actions ── */
  const handleCreateSecret = async () => {
    if (!secName.trim() || !secValue.trim()) return;
    try {
      const body: any = { name: secName.trim(), value: secValue.trim(), scope: secScope };
      if (secScope === 'flow' && secFlowId.trim()) body.flowId = secFlowId.trim();
      await apiClient.post('/api/v1/secrets', body);
      setShowCreateSecret(false);
      setSecName(''); setSecValue(''); setSecScope('global'); setSecFlowId('');
      await loadSecrets();
    } catch (e: any) { setSecretsError(e?.message ?? 'Failed to create secret'); }
  };

  const handleDeleteSecret = async (id: string) => {
    try {
      await apiClient.delete(`/api/v1/secrets/${id}`);
      await loadSecrets();
    } catch (e: any) { setSecretsError(e?.message ?? 'Failed to delete secret'); }
  };

  const handleReveal = async (id: string) => {
    if (revealedValues[id] !== undefined) {
      setRevealedValues(prev => { const n = { ...prev }; delete n[id]; return n; });
      return;
    }
    try {
      const data: any = await apiClient.get(`/api/v1/secrets/${id}/reveal`);
      setRevealedValues(prev => ({ ...prev, [id]: data.value }));
    } catch (e: any) { setSecretsError(e?.message ?? 'Failed to reveal secret'); }
  };

  /* ── Filtered data ── */
  const filteredUsers = users.filter(u => {
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
  });

  const filteredSecrets = secrets.filter(s => {
    if (!secretSearch) return true;
    const q = secretSearch.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.scope.toLowerCase().includes(q) || (s.flowId ?? '').toLowerCase().includes(q);
  });

  /* ── Stats ── */
  const userStats = {
    total: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    operator: users.filter(u => u.role === 'operator').length,
    viewer: users.filter(u => u.role === 'viewer').length,
  };

  const secretStats = {
    total: secrets.length,
    global: secrets.filter(s => s.scope === 'global').length,
    flowScoped: secrets.filter(s => s.scope === 'flow').length,
  };

  /* ── Render ── */
  return (
    <div className="tc-page">
      {/* Header */}
      <div className="tc-page-header">
        <div className="tc-page-title">
          <h1>
            <span className="br">&lt;</span>
            <span className="name">Admin</span>
            <span className="slash"> /&gt;</span>
          </h1>
          <span className="subtitle">
            {activeTab === 'users'
              ? <><span className="num">{users.length}</span> user{users.length !== 1 ? 's' : ''}</>
              : <><span className="num">{secrets.length}</span> secret{secrets.length !== 1 ? 's' : ''}</>
            }
          </span>
        </div>

        <div className="tc-toolbar">
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
            <button
              className={activeTab === 'users' ? 'tc-btn primary' : 'tc-btn ghost'}
              style={{ height: 26, padding: '0 12px', fontSize: 12, borderRadius: 6 }}
              onClick={() => setActiveTab('users')}
            >
              <Users size={12} /> Users
            </button>
            <button
              className={activeTab === 'secrets' ? 'tc-btn primary' : 'tc-btn ghost'}
              style={{ height: 26, padding: '0 12px', fontSize: 12, borderRadius: 6 }}
              onClick={() => setActiveTab('secrets')}
            >
              <Lock size={12} /> Secrets
            </button>
          </div>

          <button
            className="tc-btn ghost"
            onClick={activeTab === 'users' ? loadUsers : loadSecrets}
            title="Refresh"
          >
            <RefreshCw size={13} /> Refresh
          </button>

          {activeTab === 'users' ? (
            <button className="tc-btn primary" onClick={() => setShowCreateUser(v => !v)}>
              <Plus size={13} /> Add User
            </button>
          ) : (
            <button className="tc-btn primary" onClick={() => setShowCreateSecret(v => !v)}>
              <Plus size={13} /> Add Secret
            </button>
          )}
        </div>
      </div>

      {/* ── USERS TAB ─────────────────────────────────── */}
      {activeTab === 'users' && (
        <>
          {/* Stats */}
          <div className="tc-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="tc-stat">
              <span className="tc-stat-label">total</span>
              <span className="tc-stat-value accent">{userStats.total}</span>
            </div>
            <div className="tc-stat">
              <span className="tc-stat-label">admin</span>
              <span className="tc-stat-value" style={{ color: 'var(--accent)' }}>{userStats.admin}</span>
            </div>
            <div className="tc-stat">
              <span className="tc-stat-label">operator</span>
              <span className="tc-stat-value ok">{userStats.operator}</span>
            </div>
            <div className="tc-stat">
              <span className="tc-stat-label">viewer</span>
              <span className="tc-stat-value">{userStats.viewer}</span>
            </div>
          </div>

          {/* Create user form */}
          {showCreateUser && (
            <div className="tc-card" style={{ marginBottom: 12, padding: 16 }}>
              <div className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>New User</div>
              <div className="flex flex-col gap-3">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                  <input
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="Email"
                    className="px-3 py-1.5 rounded text-xs"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  />
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full px-3 py-1.5 rounded text-xs"
                      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                    />
                    <button onClick={() => setShowPwd(!showPwd)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
                      {showPwd ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <select
                    value={newRole}
                    onChange={e => setNewRole(e.target.value)}
                    className="px-3 py-1.5 rounded text-xs"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  >
                    <option value="admin">Admin</option>
                    <option value="operator">Operator</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowCreateUser(false)} className="tc-btn ghost" style={{ height: 28, padding: '0 12px', fontSize: 12 }}>Cancel</button>
                  <button onClick={handleCreateUser} className="tc-btn primary" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Create</button>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {usersError && (
            <div className="flex items-center gap-2 p-3 rounded text-xs mb-3"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--err)' }}>
              <AlertCircle size={13} /> {usersError}
            </div>
          )}

          {/* Search */}
          <div className="tc-search">
            <span className="icon"><Search size={14} /></span>
            <input
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Search by email or role…"
            />
          </div>

          {/* Table */}
          {usersLoading ? (
            <div className="tc-card"><div className="tc-empty">Loading…</div></div>
          ) : filteredUsers.length === 0 ? (
            <div className="tc-card">
              <div className="tc-empty">
                {userSearch ? `no users match "${userSearch}"` : 'no users yet'}
              </div>
            </div>
          ) : (
            <div className="tc-card">
              <table className="tc-table">
                <thead>
                  <tr>
                    <th style={{ width: 24 }} />
                    <th>User</th>
                    <th>Role</th>
                    <th>API Keys</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <React.Fragment key={u._id}>
                      <tr onClick={() => setExpandedUser(expandedUser === u._id ? null : u._id)}>
                        <td style={{ paddingRight: 0, width: 24, color: 'var(--text-3)' }}>
                          {expandedUser === u._id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </td>
                        <td>
                          <div className="tc-flow-cell">
                            <span className="tc-flow-icon" style={{ width: 28, height: 28, borderRadius: 7 }}>
                              <ShieldCheck size={13} />
                            </span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>
                              {u.email}
                            </span>
                          </div>
                        </td>
                        <td><RoleBadge role={u.role} /></td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: u.apiKeys?.length ? 'var(--text)' : 'var(--text-mute)' }}>
                            {u.apiKeys?.length ?? 0} key{(u.apiKeys?.length ?? 0) !== 1 ? 's' : ''}
                          </span>
                        </td>
                        <td>
                          <span className="tc-reltime">{new Date(u.createdAt).toLocaleDateString()}</span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="tc-row-actions">
                            <button
                              className="tc-icon-btn"
                              title="Add API key"
                              onClick={() => { setKeyUserId(keyUserId === u._id ? null : u._id); setKeyLabel(''); }}
                            >
                              <Key size={13} />
                            </button>
                            <button
                              className="tc-icon-btn danger"
                              title="Delete user"
                              onClick={() => handleDeleteUser(u._id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Add key inline row */}
                      {keyUserId === u._id && (
                        <tr style={{ background: 'var(--surface-2)' }}>
                          <td colSpan={6} style={{ padding: '10px 16px' }} onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <Key size={11} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                              <span className="text-xs" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Key label:</span>
                              <input
                                value={keyLabel}
                                onChange={e => setKeyLabel(e.target.value)}
                                placeholder="e.g. worker-prod"
                                autoFocus
                                className="flex-1 px-2 py-1 rounded text-xs"
                                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-mono)', maxWidth: 280 }}
                                onKeyDown={e => e.key === 'Enter' && handleCreateKey(u._id)}
                              />
                              <button onClick={() => handleCreateKey(u._id)} className="tc-btn primary" style={{ height: 26, padding: '0 10px', fontSize: 11 }}>Create</button>
                              <button onClick={() => setKeyUserId(null)} className="tc-btn ghost" style={{ height: 26, padding: '0 8px', fontSize: 11 }}>Cancel</button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Expanded keys */}
                      {expandedUser === u._id && (u.apiKeys?.length ?? 0) > 0 && (
                        u.apiKeys.map(k => (
                          <tr key={k.id} style={{ background: 'var(--surface-2)' }}>
                            <td colSpan={2} style={{ paddingLeft: 52, paddingTop: 10, paddingBottom: 10 }}>
                              <div className="flex items-center gap-2">
                                <Key size={11} style={{ color: 'var(--text-3)' }} />
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{k.label}</span>
                              </div>
                            </td>
                            <td colSpan={2}>
                              <span className="tc-reltime">
                                {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}
                              </span>
                            </td>
                            <td>
                              <span className="tc-reltime">{new Date(k.createdAt).toLocaleDateString()}</span>
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                              <div className="tc-row-actions">
                                <button
                                  className="tc-icon-btn danger"
                                  title="Revoke key"
                                  onClick={() => handleRevokeKey(u._id, k.id)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}

                      {/* Expanded — no keys */}
                      {expandedUser === u._id && (u.apiKeys?.length ?? 0) === 0 && (
                        <tr style={{ background: 'var(--surface-2)' }}>
                          <td colSpan={6} style={{ paddingLeft: 52, paddingTop: 10, paddingBottom: 10 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-mute)' }}>no API keys</span>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── SECRETS TAB ───────────────────────────────── */}
      {activeTab === 'secrets' && (
        <>
          {/* Stats */}
          <div className="tc-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="tc-stat">
              <span className="tc-stat-label">total</span>
              <span className="tc-stat-value accent">{secretStats.total}</span>
            </div>
            <div className="tc-stat">
              <span className="tc-stat-label">global</span>
              <span className="tc-stat-value">{secretStats.global}</span>
            </div>
            <div className="tc-stat">
              <span className="tc-stat-label">flow-scoped</span>
              <span className="tc-stat-value warn">{secretStats.flowScoped}</span>
            </div>
          </div>

          {/* Hint */}
          <div className="text-xs mb-3" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            AES-256-GCM encrypted at rest · reference with{' '}
            <code style={{ color: 'var(--accent)' }}>{'${{ secrets.NAME }}'}</code> in node code
          </div>

          {/* Create secret form */}
          {showCreateSecret && (
            <div className="tc-card" style={{ marginBottom: 12, padding: 16 }}>
              <div className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>New Secret</div>
              <div className="flex flex-col gap-3">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                  <input
                    value={secName}
                    onChange={e => setSecName(e.target.value)}
                    placeholder="Secret name (e.g. DB_PASSWORD)"
                    className="px-3 py-1.5 rounded text-xs font-mono"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  />
                  <input
                    type="password"
                    value={secValue}
                    onChange={e => setSecValue(e.target.value)}
                    placeholder="Secret value"
                    className="px-3 py-1.5 rounded text-xs"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  />
                  <select
                    value={secScope}
                    onChange={e => setSecScope(e.target.value as any)}
                    className="px-3 py-1.5 rounded text-xs"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  >
                    <option value="global">Global</option>
                    <option value="flow">Flow-scoped</option>
                  </select>
                </div>
                {secScope === 'flow' && (
                  <input
                    value={secFlowId}
                    onChange={e => setSecFlowId(e.target.value)}
                    placeholder="Flow ID"
                    className="px-3 py-1.5 rounded text-xs font-mono"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', maxWidth: 320 }}
                  />
                )}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowCreateSecret(false)} className="tc-btn ghost" style={{ height: 28, padding: '0 12px', fontSize: 12 }}>Cancel</button>
                  <button onClick={handleCreateSecret} className="tc-btn primary" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Save</button>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {secretsError && (
            <div className="flex items-center gap-2 p-3 rounded text-xs mb-3"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--err)' }}>
              <AlertCircle size={13} /> {secretsError}
            </div>
          )}

          {/* Search */}
          <div className="tc-search">
            <span className="icon"><Search size={14} /></span>
            <input
              value={secretSearch}
              onChange={e => setSecretSearch(e.target.value)}
              placeholder="Search by name or scope…"
            />
          </div>

          {/* Table */}
          {secretsLoading ? (
            <div className="tc-card"><div className="tc-empty">Loading…</div></div>
          ) : filteredSecrets.length === 0 ? (
            <div className="tc-card">
              <div className="tc-empty">
                {secretSearch ? `no secrets match "${secretSearch}"` : 'no secrets yet'}
              </div>
            </div>
          ) : (
            <div className="tc-card">
              <table className="tc-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Scope</th>
                    <th>Value</th>
                    <th>Updated</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSecrets.map(s => (
                    <tr key={s._id} style={{ cursor: 'default' }}>
                      <td>
                        <div className="tc-flow-cell">
                          <span className="tc-flow-icon" style={{ width: 28, height: 28, borderRadius: 7 }}>
                            <Lock size={13} />
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>
                            {s.name}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 4,
                          background: 'var(--surface-hi)', border: '1px solid var(--border)',
                          fontFamily: 'var(--font-mono)', fontSize: 11,
                          color: s.scope === 'global' ? 'var(--ok)' : 'var(--warn)',
                        }}>
                          {s.scope}{s.scope === 'flow' && s.flowId ? ` · ${s.flowId.slice(0, 8)}` : ''}
                        </span>
                      </td>
                      <td>
                        {revealedValues[s._id] !== undefined ? (
                          <code style={{ fontSize: 11, color: 'var(--warn)', fontFamily: 'var(--font-mono)', background: 'var(--surface-hi)', padding: '2px 6px', borderRadius: 4 }}>
                            {revealedValues[s._id]}
                          </code>
                        ) : (
                          <span style={{ color: 'var(--text-mute)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 2 }}>••••••••</span>
                        )}
                      </td>
                      <td>
                        <span className="tc-reltime">{new Date(s.updatedAt).toLocaleDateString()}</span>
                      </td>
                      <td>
                        <div className="tc-row-actions">
                          <button
                            className="tc-icon-btn"
                            title={revealedValues[s._id] !== undefined ? 'Hide value' : 'Reveal value (admin)'}
                            onClick={() => handleReveal(s._id)}
                          >
                            {revealedValues[s._id] !== undefined ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <button
                            className="tc-icon-btn danger"
                            title="Delete secret"
                            onClick={() => handleDeleteSecret(s._id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {rawKey && <RawKeyModal rawKey={rawKey} onClose={() => setRawKey(null)} />}
    </div>
  );
};

export default AdminLayout;
