import React, { useEffect, useState } from 'react';
import { X, Clock, AlertCircle, Globe, Copy, Check, Trash2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { apiClient } from '../../utils/apiClient';
import type { OrchestratorFlow } from '../../types/flows';

interface Props {
  flow: OrchestratorFlow;
  onClose: () => void;
  onSave: (schedule: { cron: string; enabled: boolean; timezone: string } | null) => Promise<void>;
}

const PRESETS = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day at midnight', cron: '0 0 * * *' },
  { label: 'Every day at 9am', cron: '0 9 * * *' },
  { label: 'Every Monday at 9am', cron: '0 9 * * 1' },
  { label: 'Every weekday at 9am', cron: '0 9 * * 1-5' },
];

function parseCronHuman(expr: string): string {
  if (!expr.trim()) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return 'Invalid cron expression';
  const preset = PRESETS.find(p => p.cron === expr.trim());
  if (preset) return preset.label;
  return `Custom: ${expr}`;
}

type Tab = 'cron' | 'api';

interface ApiTrigger {
  scheduleId: string;
  tokenId: string;
  url: string;
  label: string;
  createdAt: string;
}

const ScheduleModal: React.FC<Props> = ({ flow, onClose, onSave }) => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [tab, setTab] = useState<Tab>('cron');

  // Cron tab state
  const [cron, setCron] = useState(flow.schedule?.cron || '0 * * * *');
  const [enabled, setEnabled] = useState(flow.schedule?.enabled ?? true);
  const [cronScheduleId, setCronScheduleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // API trigger tab state
  const [apiLabel, setApiLabel] = useState('API Trigger');
  const [apiTriggers, setApiTriggers] = useState<ApiTrigger[]>([]);
  const [creating, setCreating] = useState(false);
  const [copiedFor, setCopiedFor] = useState<string | null>(null);

  const cronParts = cron.trim().split(/\s+/);
  const isValid = cronParts.length === 5 && cronParts.every(p => /^[\d*,\/\-]+$/.test(p));

  // Load the existing cron schedule (if any) when the Cron tab opens. The
  // cron scheduler service watches the `schedules` collection — flow.schedule
  // alone does nothing, so we have to round-trip there.
  useEffect(() => {
    if (tab !== 'cron') return;
    (async () => {
      try {
        const data: any = await apiClient.get(`/api/v1/schedules?flowId=${encodeURIComponent(flow.id)}`);
        const cronRows = (data.schedules || []).filter((s: any) => s.type === 'cron');
        if (cronRows.length > 0) {
          // First row wins — keeps the modal single-cron for now.
          const row = cronRows[0];
          setCronScheduleId(row._id);
          setCron(row.cronExpr || '0 * * * *');
          setEnabled(row.enabled !== false);
        } else {
          setCronScheduleId(null);
        }
      } catch (err) {
        console.error('Failed to load cron schedule', err);
      }
    })();
  }, [tab, flow.id]);

  // Load existing api-trigger schedules for this flow when the API tab opens.
  useEffect(() => {
    if (tab !== 'api') return;
    (async () => {
      try {
        const data: any = await apiClient.get(`/api/v1/schedules?flowId=${encodeURIComponent(flow.id)}`);
        const apiSchedules = (data.schedules || []).filter((s: any) => s.type === 'api');
        // Surface schedule placeholders even when we don't have the raw token URL anymore.
        const triggers: ApiTrigger[] = apiSchedules.map((s: any) => ({
          scheduleId: s._id,
          tokenId: '',
          url: s.lastUrl || '(token shown only at creation)',
          label: s.label || 'API Trigger',
          createdAt: s.createdAt,
        }));
        setApiTriggers(triggers);
      } catch (err) {
        console.error('Failed to load api triggers', err);
      }
    })();
  }, [tab, flow.id]);

  const handleSaveCron = async () => {
    if (!isValid) { setError('Enter a valid 5-field cron expression'); return; }
    setLoading(true);
    setError('');
    try {
      const payload = { cronExpr: cron.trim(), enabled, label: cron.trim() };
      if (cronScheduleId) {
        // Update existing row — the server's PATCH handler re-registers the
        // node-cron task with the new expression / enabled flag.
        await apiClient.patch(`/api/v1/schedules/${cronScheduleId}`, payload);
      } else {
        const created: any = await apiClient.post('/api/v1/schedules/cron', { flowId: flow.id, ...payload });
        setCronScheduleId(created?._id || null);
      }
      // Mirror to flow.schedule so the row badge in FlowsList keeps showing
      // the cron string. This is purely for display — the cron service reads
      // from the schedules collection, not this field.
      await onSave({ cron: cron.trim(), enabled, timezone: 'UTC' });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setLoading(true);
    try {
      if (cronScheduleId) {
        await apiClient.delete(`/api/v1/schedules/${cronScheduleId}`);
        setCronScheduleId(null);
      }
      await onSave(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove schedule');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateApiTrigger = async () => {
    setCreating(true);
    setError('');
    try {
      const res: any = await apiClient.post('/api/v1/schedules/api-trigger', {
        flowId: flow.id, label: apiLabel || 'API Trigger',
      });
      // Stash the full URL once — the raw token isn't shown again afterwards.
      setApiTriggers(prev => [
        { scheduleId: res.scheduleId, tokenId: res.tokenId, url: res.url, label: apiLabel, createdAt: new Date().toISOString() },
        ...prev,
      ]);
    } catch (err: any) {
      setError(err?.message || 'Failed to create API trigger');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTrigger = async (scheduleId: string) => {
    try {
      await apiClient.delete(`/api/v1/schedules/${scheduleId}`);
      setApiTriggers(prev => prev.filter(t => t.scheduleId !== scheduleId));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete trigger');
    }
  };

  const copyUrl = async (url: string, scheduleId: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedFor(scheduleId);
      setTimeout(() => setCopiedFor(null), 1500);
    } catch { /* clipboard might be denied */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-lg rounded-xl shadow-2xl border ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Triggers</h2>
              <p className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{flow.name}</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 px-5 pt-3 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
          <button
            onClick={() => setTab('cron')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === 'cron' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Cron
          </button>
          <button
            onClick={() => setTab('api')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === 'api' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            API Trigger
          </button>
        </div>

        {tab === 'cron' && (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Enabled</span>
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors`}
                style={{ background: enabled ? 'var(--accent)' : 'var(--surface-hi)' }}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-2 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>Presets</label>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESETS.map(preset => (
                  <button
                    key={preset.cron}
                    type="button"
                    onClick={() => setCron(preset.cron)}
                    className={`text-left px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
                      cron === preset.cron
                        ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                        : dark
                        ? 'border-gray-700 hover:border-gray-600 text-gray-400'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                Cron Expression <span className={`font-normal ${dark ? 'text-gray-600' : 'text-gray-400'}`}>(minute hour dayMonth month dayWeek)</span>
              </label>
              <input
                value={cron}
                onChange={e => setCron(e.target.value)}
                placeholder="0 * * * *"
                className={`w-full px-3 py-2 rounded-lg border text-sm font-mono ${
                  dark ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 focus:border-purple-500'
                       : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500'
                } focus:outline-none focus:ring-1 focus:ring-purple-500 ${!isValid && cron ? 'border-red-500' : ''}`}
              />
              {cron && (
                <p className={`text-xs mt-1 ${isValid ? (dark ? 'text-gray-500' : 'text-gray-400') : 'text-red-400'}`}>
                  {isValid ? parseCronHuman(cron) : 'Invalid cron expression'}
                </p>
              )}
            </div>

            <p className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>Timezone: UTC</p>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {(flow.schedule || cronScheduleId) && (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={loading}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${dark ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800' : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200'} disabled:opacity-50`}
                >
                  Remove
                </button>
              )}
              <button type="button" onClick={onClose} className={`flex-1 py-2 rounded-lg text-sm font-medium ${dark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCron}
                disabled={loading || !isValid}
                className="tc-btn primary" style={{ flex: 1, height: 38, justifyContent: 'center' }}
              >
                {loading ? 'Saving…' : 'Save Cron'}
              </button>
            </div>
          </div>
        )}

        {tab === 'api' && (
          <div className="p-5 space-y-4">
            <p className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
              Generate a unique URL that triggers this flow on HTTP GET. The token is shown only once at creation —
              copy it now or you'll have to recreate the trigger.
            </p>

            <div className="flex gap-2">
              <input
                value={apiLabel}
                onChange={e => setApiLabel(e.target.value)}
                placeholder="Trigger label"
                className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                  dark ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500'
                       : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                } focus:outline-none focus:ring-1 focus:ring-purple-500`}
              />
              <button
                type="button"
                onClick={handleCreateApiTrigger}
                disabled={creating}
                className="tc-btn primary"
                style={{ height: 38, padding: '0 14px' }}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {apiTriggers.length > 0 ? (
              <div className="flex flex-col gap-2">
                {apiTriggers.map(t => (
                  <div key={t.scheduleId} className={`p-3 rounded-lg border ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{t.label}</span>
                      <button
                        onClick={() => handleDeleteTrigger(t.scheduleId)}
                        className="p-1 rounded hover:bg-red-900/30"
                        title="Revoke"
                      >
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <code
                        className="flex-1 truncate px-2 py-1 rounded text-xs"
                        style={{ background: 'var(--bg-3)', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
                        title={t.url}
                      >
                        {t.url}
                      </code>
                      {t.url.startsWith('http') && (
                        <button
                          onClick={() => copyUrl(t.url, t.scheduleId)}
                          className="tc-btn ghost"
                          style={{ height: 26, padding: '0 8px', fontSize: 11, gap: 4 }}
                        >
                          {copiedFor === t.scheduleId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedFor === t.scheduleId ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`text-xs italic ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                No API triggers yet — create one to get a fetch URL.
              </p>
            )}

            <div className="flex justify-end pt-1">
              <button type="button" onClick={onClose} className={`px-4 py-2 rounded-lg text-sm font-medium ${dark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduleModal;
