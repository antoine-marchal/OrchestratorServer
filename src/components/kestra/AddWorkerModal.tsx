import React, { useState } from 'react';
import { X, Server, Wifi, WifiOff, Loader2, AlertCircle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useWorkerStore } from '../../store/workerStore';
import { pingWorker } from '../../utils/kestraApi';
import type { Worker } from '../../utils/kestraApi';

interface Props {
  worker?: Worker;           // if provided, we're editing
  onClose: () => void;
}

const COLOR_OPTIONS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
];

const AddWorkerModal: React.FC<Props> = ({ worker, onClose }) => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { addWorker, updateWorker } = useWorkerStore();

  const [name, setName] = useState(worker?.name ?? '');
  const [url, setUrl] = useState(worker?.url ?? 'http://localhost:3000');
  const [apiKey, setApiKey] = useState(worker?.apiKey ?? '');
  const [color, setColor] = useState(worker?.color ?? COLOR_OPTIONS[0]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEdit = !!worker;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const ok = await pingWorker({ id: worker?.id ?? '', name, url, apiKey, color });
    setTestResult(ok ? 'ok' : 'fail');
    setTesting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    if (!url.trim()) { setError('URL is required'); return; }
    if (!apiKey.trim()) { setError('API key is required'); return; }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        updateWorker(worker!.id, { name: name.trim(), url: url.trim(), apiKey: apiKey.trim(), color });
      } else {
        addWorker({ name: name.trim(), url: url.trim(), apiKey: apiKey.trim(), color });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-xl shadow-2xl border ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + '33' }}>
              <Server className="w-4 h-4" style={{ color }} />
            </div>
            <h2 className="text-base font-semibold">{isEdit ? 'Edit Worker' : 'Add Worker'}</h2>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
              Name <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Local Dev"
              className={`w-full px-3 py-2 rounded-lg border text-sm ${dark ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 focus:border-purple-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500'} focus:outline-none focus:ring-1 focus:ring-purple-500`}
            />
          </div>

          {/* URL */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
              Backend URL <span className="text-red-400">*</span>
            </label>
            <input
              value={url}
              onChange={e => { setUrl(e.target.value); setTestResult(null); }}
              placeholder="http://localhost:3000"
              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono ${dark ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 focus:border-purple-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500'} focus:outline-none focus:ring-1 focus:ring-purple-500`}
            />
          </div>

          {/* API Key */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
              API Key <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder="••••••••••••••••••••••••••••••••"
              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono ${dark ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 focus:border-purple-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500'} focus:outline-none focus:ring-1 focus:ring-purple-500`}
            />
            <p className={`text-xs mt-1 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
              Found in the server console on startup, or in <code className="font-mono">server-api-key.txt</code>
            </p>
          </div>

          {/* Color */}
          <div>
            <label className={`block text-xs font-medium mb-2 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>Color</label>
            <div className="flex items-center gap-2">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 scale-110' : ''} ${dark ? 'ring-offset-gray-900' : 'ring-offset-white'}`}
                  style={{ background: c, ringColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Test connection */}
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${dark ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !url.trim() || !apiKey.trim()}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${dark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'} disabled:opacity-50`}
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              Test Connection
            </button>
            {testResult === 'ok' && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Wifi className="w-3.5 h-3.5" /> Connected
              </span>
            )}
            {testResult === 'fail' && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <WifiOff className="w-3.5 h-3.5" /> Unreachable
              </span>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className={`flex-1 py-2 rounded-lg text-sm font-medium ${dark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Update Worker' : 'Add Worker'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddWorkerModal;
