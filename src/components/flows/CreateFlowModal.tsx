import React, { useState } from 'react';
import { X, GitBranch, Server, Plus, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useWorkerStore } from '../../store/workerStore';
import type { WorkerStatus } from '../../store/workerStore';
import { useNavigate } from 'react-router-dom';

interface Props {
  onClose: () => void;
  onCreate: (data: { name: string; namespace: string; description: string; workerId: string }) => Promise<void>;
}

const STATUS_ICON: Record<WorkerStatus, React.ElementType> = {
  connected: Wifi,
  disconnected: WifiOff,
  checking: Loader2,
  unknown: Server,
};

const CreateFlowModal: React.FC<Props> = ({ onClose, onCreate }) => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const navigate = useNavigate();
  const { workers, statuses } = useWorkerStore();

  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [description, setDescription] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Flow name is required'); return; }
    setLoading(true);
    setError('');
    try {
      await onCreate({ name: name.trim(), namespace: namespace.trim() || 'default', description: description.trim(), workerId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create flow');
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
            <div className="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center">
              <GitBranch className="w-4 h-4 text-purple-400" />
            </div>
            <h2 className="text-base font-semibold">Create Flow</h2>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
              Flow Name <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-workflow"
              className={`w-full px-3 py-2 rounded-lg border text-sm ${dark ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 focus:border-purple-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500'} focus:outline-none`}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>Namespace</label>
            <input
              value={namespace}
              onChange={e => setNamespace(e.target.value)}
              placeholder="default"
              className={`w-full px-3 py-2 rounded-lg border text-sm ${dark ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 focus:border-purple-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500'} focus:outline-none`}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this flow do?"
              rows={2}
              className={`w-full px-3 py-2 rounded-lg border text-sm resize-none ${dark ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 focus:border-purple-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500'} focus:outline-none`}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
              Worker <span className={`font-normal ${dark ? 'text-gray-600' : 'text-gray-400'}`}>(optional)</span>
            </label>
            {workers.length === 0 ? (
              <div className={`flex items-center gap-2.5 p-3 rounded-lg border ${dark ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                <Server className={`w-3.5 h-3.5 flex-shrink-0 ${dark ? 'text-gray-600' : 'text-gray-400'}`} />
                <p className={`text-xs flex-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>No workers — you can assign one later</p>
                <button type="button" onClick={() => { onClose(); navigate('/workers'); }} className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 flex-shrink-0">
                  <Plus className="w-3 h-3" />Add
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setWorkerId('')}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                    workerId === '' ? 'border-purple-500 bg-purple-500/10'
                    : dark ? 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                    : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${dark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <Server className={`w-3.5 h-3.5 ${dark ? 'text-gray-500' : 'text-gray-400'}`} />
                  </div>
                  <span className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>None (assign later)</span>
                </button>
                {workers.map(worker => {
                  const st = statuses[worker.id] ?? 'unknown';
                  const Icon = STATUS_ICON[st];
                  const isSelected = workerId === worker.id;
                  return (
                    <button
                      key={worker.id}
                      type="button"
                      onClick={() => setWorkerId(worker.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                        isSelected ? 'border-purple-500 bg-purple-500/10'
                        : dark ? 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                        : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                      }`}
                    >
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: worker.color + '33' }}>
                        <Server className="w-3.5 h-3.5" style={{ color: worker.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{worker.name}</p>
                        <p className={`text-xs font-mono truncate ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{worker.url}</p>
                      </div>
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${st === 'connected' ? 'text-emerald-400' : st === 'disconnected' ? 'text-red-400' : st === 'checking' ? 'text-blue-400 animate-spin' : dark ? 'text-gray-600' : 'text-gray-400'}`} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className={`flex-1 py-2 rounded-lg text-sm font-medium ${dark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">
              {loading ? 'Creating…' : 'Create Flow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateFlowModal;
