import React, { useEffect, useState } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Key,
  Copy,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { apiClient } from '../../utils/apiClient';

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
          <button onClick={copy} className="tc-btn ghost" style={{ height: 24, padding: '0 8px', flexShrink: 0, gap: 4, fontSize: 11 }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="tc-btn" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Done</button>
        </div>
      </div>
    </div>
  );
}

export const UsersPanel: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [showPwd, setShowPwd] = useState(false);

  // Create API key form
  const [keyUserId, setKeyUserId] = useState<string | null>(null);
  const [keyLabel, setKeyLabel] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get('/api/v1/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    try {
      await apiClient.post('/api/v1/users', { email, password, role });
      setShowCreate(false);
      setEmail(''); setPassword(''); setRole('operator');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create user');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/api/v1/users/${id}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete user');
    }
  };

  const handleCreateKey = async (userId: string) => {
    if (!keyLabel.trim()) return;
    try {
      const result: any = await apiClient.post(`/api/v1/users/${userId}/apikeys`, { label: keyLabel });
      setRawKey(result.rawKey);
      setKeyUserId(null);
      setKeyLabel('');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create API key');
    }
  };

  const handleRevokeKey = async (userId: string, keyId: string) => {
    try {
      await apiClient.delete(`/api/v1/users/${userId}/apikeys/${keyId}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to revoke API key');
    }
  };

  const roleColor = (r: string) => r === 'admin' ? 'var(--accent)' : r === 'operator' ? 'var(--ok)' : 'var(--text-3)';

  return (
    <div className="h-full overflow-auto p-6" style={{ background: 'var(--bg)' }}>
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={16} style={{ color: 'var(--accent)' }} />
            <span className="font-semibold text-sm" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>Users</span>
          </div>
          <button onClick={() => setShowCreate(!showCreate)} className="tc-btn ghost" style={{ height: 28, padding: '0 10px', gap: 5, fontSize: 12 }}>
            <Plus size={12} /> Add User
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--err)' }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {showCreate && (
          <div className="p-4 rounded-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>New User</h3>
            <div className="flex flex-col gap-3">
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="w-full px-3 py-1.5 rounded text-xs" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                <button onClick={() => setShowPwd(!showPwd)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
                  {showPwd ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <select value={role} onChange={e => setRole(e.target.value)} className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <option value="admin">Admin</option>
                <option value="operator">Operator</option>
                <option value="viewer">Viewer</option>
              </select>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCreate(false)} className="tc-btn ghost" style={{ height: 28, padding: '0 12px', fontSize: 12 }}>Cancel</button>
                <button onClick={handleCreate} className="tc-btn primary" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Create</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-3)' }}>Loading…</div>
        ) : (
          <div className="flex flex-col gap-2">
            {users.map(u => (
              <div key={u._id} className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setExpandedUser(expandedUser === u._id ? null : u._id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-3)' }}
                  >
                    {expandedUser === u._id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{u.email}</span>
                  <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: 'var(--bg-3)', color: roleColor(u.role) }}>{u.role}</span>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>{u.apiKeys?.length ?? 0} keys</span>
                  <button
                    onClick={() => { setKeyUserId(u._id); setKeyLabel(''); }}
                    className="tc-btn ghost"
                    style={{ height: 24, padding: '0 8px', gap: 4, fontSize: 11 }}
                    title="Add API key"
                  >
                    <Key size={11} />
                  </button>
                  <button onClick={() => handleDelete(u._id)} className="tc-btn ghost" style={{ height: 24, width: 24, padding: 0, justifyContent: 'center' }} title="Delete user">
                    <Trash2 size={12} style={{ color: 'var(--err)' }} />
                  </button>
                </div>

                {keyUserId === u._id && (
                  <div className="px-4 pb-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>New key label:</span>
                    <input value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="e.g. worker-prod" className="flex-1 px-2 py-1 rounded text-xs" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }} onKeyDown={e => e.key === 'Enter' && handleCreateKey(u._id)} />
                    <button onClick={() => handleCreateKey(u._id)} className="tc-btn primary" style={{ height: 24, padding: '0 10px', fontSize: 11 }}>Create</button>
                    <button onClick={() => setKeyUserId(null)} className="tc-btn ghost" style={{ height: 24, padding: '0 8px', fontSize: 11 }}>Cancel</button>
                  </div>
                )}

                {expandedUser === u._id && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {u.apiKeys?.length === 0 ? (
                      <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>No API keys</div>
                    ) : (
                      u.apiKeys.map(k => (
                        <div key={k.id} className="flex items-center gap-3 px-10 py-2" style={{ borderTop: '1px solid var(--border)' }}>
                          <Key size={11} style={{ color: 'var(--text-3)' }} />
                          <span className="text-xs flex-1 font-mono" style={{ color: 'var(--text)' }}>{k.label}</span>
                          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                            {k.lastUsedAt ? `Used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'Never used'}
                          </span>
                          <button onClick={() => handleRevokeKey(u._id, k.id)} className="tc-btn ghost" style={{ height: 22, padding: '0 7px', gap: 3, fontSize: 10, color: 'var(--err)' }} title="Revoke key">
                            <Trash2 size={10} /> Revoke
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {rawKey && <RawKeyModal rawKey={rawKey} onClose={() => setRawKey(null)} />}
    </div>
  );
};

export default UsersPanel;
