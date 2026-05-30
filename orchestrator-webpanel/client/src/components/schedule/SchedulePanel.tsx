import React, { useEffect, useState } from 'react';
import {
  CalendarClock,
  Plus,
  Trash2,
  Globe,
  Clock,
  Zap,
  Copy,
  Check,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
} from 'lucide-react';
import { apiClient } from '../../utils/apiClient';

interface Schedule {
  _id: string;
  type: 'cron' | 'event' | 'api-trigger';
  flowId: string;
  enabled: boolean;
  cronExpr?: string;
  eventName?: string;
  token?: string;
  triggerUrl?: string;
  description?: string;
  createdAt: string;
}

interface SchedulePanelProps {
  flowId: string;
}

const TriggerLinkModal: React.FC<{ url: string; onClose: () => void }> = ({ url, onClose }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg p-6 w-full max-w-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>API Trigger URL</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
          Share this URL to trigger the flow via HTTP GET. Keep it secret — anyone with this URL can execute the flow.
        </p>
        <div className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)' }}>
          <code className="text-xs flex-1 truncate" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{url}</code>
          <button onClick={copy} className="tc-btn ghost" style={{ height: 24, padding: '0 8px', flexShrink: 0, gap: 4, fontSize: 11 }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="tc-btn" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Close</button>
        </div>
      </div>
    </div>
  );
};

const SchedulePanel: React.FC<SchedulePanelProps> = ({ flowId }) => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<'cron' | 'event' | 'api-trigger' | null>(null);
  const [triggerUrl, setTriggerUrl] = useState<string | null>(null);

  // form state
  const [cronExpr, setCronExpr] = useState('0 * * * *');
  const [eventName, setEventName] = useState('');
  const [description, setDescription] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get(`/api/v1/schedules?flowId=${flowId}`);
      setSchedules(Array.isArray(data) ? data : data.schedules ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [flowId]);

  const handleCreate = async () => {
    if (!creating) return;
    try {
      const body: any = { flowId, description, enabled: true };
      if (creating === 'cron') body.cronExpr = cronExpr;
      if (creating === 'event') body.eventName = eventName;

      const result = await apiClient.post(`/api/v1/schedules/${creating}`, body);
      setCreating(null);
      setCronExpr('0 * * * *');
      setEventName('');
      setDescription('');
      if (creating === 'api-trigger' && result.triggerUrl) {
        setTriggerUrl(result.triggerUrl);
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create schedule');
    }
  };

  const handleToggle = async (s: Schedule) => {
    try {
      await apiClient.patch(`/api/v1/schedules/${s._id}`, { enabled: !s.enabled });
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update schedule');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/api/v1/schedules/${id}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete schedule');
    }
  };

  const typeIcon = (type: string) => {
    if (type === 'cron') return <Clock size={13} style={{ color: 'var(--accent)' }} />;
    if (type === 'event') return <Zap size={13} style={{ color: 'var(--warn)' }} />;
    return <Globe size={13} style={{ color: 'var(--ok)' }} />;
  };

  const typeLabel = (type: string) => {
    if (type === 'cron') return 'Cron';
    if (type === 'event') return 'Event';
    return 'API Trigger';
  };

  return (
    <div className="h-full flex flex-col overflow-auto p-6 gap-6" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} style={{ color: 'var(--accent)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>Schedules & Triggers</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCreating('cron')} className="tc-btn ghost" style={{ height: 28, padding: '0 10px', gap: 5, fontSize: 12 }}>
            <Plus size={12} /><Clock size={12} /> Cron
          </button>
          <button onClick={() => setCreating('event')} className="tc-btn ghost" style={{ height: 28, padding: '0 10px', gap: 5, fontSize: 12 }}>
            <Plus size={12} /><Zap size={12} /> Event
          </button>
          <button onClick={() => setCreating('api-trigger')} className="tc-btn ghost" style={{ height: 28, padding: '0 10px', gap: 5, fontSize: 12 }}>
            <Plus size={12} /><Globe size={12} /> API Trigger
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--err)' }}>
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {/* Create form */}
      {creating && (
        <div className="p-4 rounded-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
          <h3 className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            New {typeLabel(creating)}
          </h3>
          <div className="flex flex-col gap-3">
            {creating === 'cron' && (
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>Cron expression</label>
                <input
                  value={cronExpr}
                  onChange={e => setCronExpr(e.target.value)}
                  placeholder="0 * * * *"
                  className="w-full px-3 py-1.5 rounded text-xs font-mono"
                  style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
              </div>
            )}
            {creating === 'event' && (
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>Event name</label>
                <input
                  value={eventName}
                  onChange={e => setEventName(e.target.value)}
                  placeholder="e.g. file.arrived"
                  className="w-full px-3 py-1.5 rounded text-xs font-mono"
                  style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
              </div>
            )}
            {creating === 'api-trigger' && (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                A unique trigger URL will be generated. You can copy it after creation.
              </p>
            )}
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>Description (optional)</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What triggers this?"
                className="w-full px-3 py-1.5 rounded text-xs"
                style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCreating(null)} className="tc-btn ghost" style={{ height: 28, padding: '0 12px', fontSize: 12 }}>Cancel</button>
              <button onClick={handleCreate} className="tc-btn primary" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule list */}
      {loading ? (
        <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-3)' }}>
          <span className="text-sm">Loading…</span>
        </div>
      ) : schedules.length === 0 && !creating ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--text-3)' }}>
          <CalendarClock size={32} />
          <p className="text-sm">No schedules — add a cron, event, or API trigger above</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {schedules.map(s => (
            <div key={s._id} className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              {typeIcon(s.type)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                    {s.type === 'cron' && s.cronExpr}
                    {s.type === 'event' && s.eventName}
                    {s.type === 'api-trigger' && 'API Trigger'}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-3)', color: 'var(--text-3)' }}>
                    {typeLabel(s.type)}
                  </span>
                  {!s.enabled && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--err)' }}>disabled</span>
                  )}
                </div>
                {s.description && (
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{s.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {s.type === 'api-trigger' && s.triggerUrl && (
                  <button
                    onClick={() => setTriggerUrl(s.triggerUrl!)}
                    className="tc-btn ghost"
                    style={{ height: 24, padding: '0 8px', gap: 4, fontSize: 11 }}
                    title="Show trigger URL"
                  >
                    <Globe size={11} /> URL
                  </button>
                )}
                <button onClick={() => handleToggle(s)} title={s.enabled ? 'Disable' : 'Enable'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                  {s.enabled
                    ? <ToggleRight size={18} style={{ color: 'var(--ok)' }} />
                    : <ToggleLeft size={18} style={{ color: 'var(--text-3)' }} />}
                </button>
                <button onClick={() => handleDelete(s._id)} className="tc-btn ghost" style={{ height: 24, width: 24, padding: 0, justifyContent: 'center' }} title="Delete">
                  <Trash2 size={12} style={{ color: 'var(--err)' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {triggerUrl && <TriggerLinkModal url={triggerUrl} onClose={() => setTriggerUrl(null)} />}
    </div>
  );
};

export default SchedulePanel;
