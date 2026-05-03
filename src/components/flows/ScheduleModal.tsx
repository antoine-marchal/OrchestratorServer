import React, { useState } from 'react';
import { X, Clock, AlertCircle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import type { OrchestratorFlow } from '../../utils/workerApi';

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

const ScheduleModal: React.FC<Props> = ({ flow, onClose, onSave }) => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [cron, setCron] = useState(flow.schedule?.cron || '0 * * * *');
  const [enabled, setEnabled] = useState(flow.schedule?.enabled ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cronParts = cron.trim().split(/\s+/);
  const isValid = cronParts.length === 5 && cronParts.every(p => /^[\d*,\/\-]+$/.test(p));

  const handleSave = async () => {
    if (!isValid) { setError('Enter a valid 5-field cron expression'); return; }
    setLoading(true);
    setError('');
    try {
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
      await onSave(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove schedule');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-xl shadow-2xl border ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Schedule</h2>
              <p className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{flow.name}</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Enabled</span>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors`} style={{ background: enabled ? 'var(--accent)' : 'var(--surface-hi)' }}
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
            {flow.schedule && (
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
              onClick={handleSave}
              disabled={loading || !isValid}
              className="tc-btn primary" style={{ flex: 1, height: 38, justifyContent: 'center' }}
            >
              {loading ? 'Saving…' : 'Save Schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleModal;
