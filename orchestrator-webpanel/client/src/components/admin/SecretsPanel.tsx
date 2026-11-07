import React, { useEffect, useState } from 'react';
import { Lock, Plus, Trash2, Eye, AlertCircle } from 'lucide-react';
import { secretsApi } from '../../api';

interface Secret {
  _id: string;
  name: string;
  scope: 'global' | 'flow';
  flowId?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export const SecretsPanel: React.FC = () => {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});

  // form
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<'global' | 'flow'>('global');
  const [flowId, setFlowId] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await secretsApi.list();
      setSecrets(Array.isArray(data) ? data : data.secrets ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load secrets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || !value.trim()) return;
    try {
      const body: any = { name: name.trim(), value: value.trim(), scope };
      if (scope === 'flow' && flowId.trim()) body.flowId = flowId.trim();
      await secretsApi.create(body);
      setShowCreate(false);
      setName(''); setValue(''); setScope('global'); setFlowId('');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create secret');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await secretsApi.remove(id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete secret');
    }
  };

  const handleReveal = async (id: string) => {
    if (revealedValues[id] !== undefined) {
      setRevealedValues(prev => { const n = { ...prev }; delete n[id]; return n; });
      return;
    }
    try {
      const data: any = await secretsApi.reveal(id);
      setRevealedValues(prev => ({ ...prev, [id]: data.value }));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to reveal secret');
    }
  };

  return (
    <div className="h-full overflow-auto p-6" style={{ background: 'var(--bg)' }}>
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock size={16} style={{ color: 'var(--accent)' }} />
            <span className="font-semibold text-sm" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>Secrets</span>
          </div>
          <button onClick={() => setShowCreate(!showCreate)} className="tc-btn ghost" style={{ height: 28, padding: '0 10px', gap: 5, fontSize: 12 }}>
            <Plus size={12} /> Add Secret
          </button>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          Secrets are AES-256-GCM encrypted at rest. Reference them in nodes with <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{'{'}{'{'} secrets.NAME {'}'}{'}'}</code>
        </p>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-sm text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--err)' }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {showCreate && (
          <div className="p-4 rounded-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>New Secret</h3>
            <div className="flex flex-col gap-3">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Secret name (e.g. DB_PASSWORD)" className="px-3 py-1.5 rounded-sm text-xs font-mono" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <input type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="Secret value" className="px-3 py-1.5 rounded-sm text-xs" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <div className="flex items-center gap-3">
                <select value={scope} onChange={e => setScope(e.target.value as any)} className="px-3 py-1.5 rounded-sm text-xs" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                  <option value="global">Global</option>
                  <option value="flow">Flow-scoped</option>
                </select>
                {scope === 'flow' && (
                  <input value={flowId} onChange={e => setFlowId(e.target.value)} placeholder="Flow ID" className="flex-1 px-3 py-1.5 rounded-sm text-xs font-mono" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCreate(false)} className="tc-btn ghost" style={{ height: 28, padding: '0 12px', fontSize: 12 }}>Cancel</button>
                <button onClick={handleCreate} className="tc-btn primary" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Save</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-3)' }}>Loading…</div>
        ) : secrets.length === 0 && !showCreate ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--text-3)' }}>
            <Lock size={32} />
            <p className="text-sm">No secrets yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {secrets.map(s => (
              <div key={s._id} className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <Lock size={13} style={{ color: 'var(--text-3)' }} />
                <span className="text-sm font-mono flex-1" style={{ color: 'var(--text)' }}>{s.name}</span>
                {s.scope === 'flow' && (
                  <span className="text-xs px-1.5 py-0.5 rounded-sm font-mono" style={{ background: 'var(--bg-3)', color: 'var(--text-3)' }}>flow</span>
                )}
                {revealedValues[s._id] !== undefined ? (
                  <code className="text-xs px-2 py-1 rounded-sm max-w-48 truncate" style={{ background: 'var(--bg-3)', color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>
                    {revealedValues[s._id]}
                  </code>
                ) : null}
                <button onClick={() => handleReveal(s._id)} className="tc-btn ghost" style={{ height: 24, padding: '0 8px', gap: 4, fontSize: 11 }} title={revealedValues[s._id] !== undefined ? 'Hide' : 'Reveal (admin)'}>
                  <Eye size={11} />
                </button>
                <button onClick={() => handleDelete(s._id)} className="tc-btn ghost" style={{ height: 24, width: 24, padding: 0, justifyContent: 'center' }} title="Delete">
                  <Trash2 size={12} style={{ color: 'var(--err)' }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SecretsPanel;
