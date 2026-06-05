import React, { useState } from 'react';
import { X, GitBranch, Server, Wifi, WifiOff } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useServerWorkers, canUseWorker } from '../../hooks/useServerWorkers';
import { useAuth } from '../../hooks/useAuth';

interface Props {
  onClose: () => void;
  onCreate: (data: { name: string; namespace: string; description: string; workerId: string }) => Promise<void>;
}

const CreateFlowModal: React.FC<Props> = ({ onClose, onCreate }) => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { workers: allWorkers } = useServerWorkers();
  const { role, login } = useAuth();
  // Only workers the user is allowed to run on are selectable (mirrors the gate
  // in /flows). Without this an operator could pick a forbidden worker here.
  const workers = allWorkers.filter(w => canUseWorker(w, role, login));

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
            <div className="tc-flow-icon" style={{ width: 32, height: 32, flexShrink: 0 }}>
              <GitBranch size={14} />
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
                <span className={`text-sm ${dark ? 'text-gray-300' : 'text-gray-700'}`}>Server (default)</span>
              </button>
              {workers.map(worker => {
                const isSelected = workerId === worker._id;
                const online = worker.status === 'online';
                const Icon = online ? Wifi : WifiOff;
                return (
                  <button
                    key={worker._id}
                    type="button"
                    onClick={() => setWorkerId(worker._id)}
                    disabled={!online}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                      isSelected ? 'border-purple-500 bg-purple-500/10'
                      : dark ? 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                      : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                    } ${!online ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${dark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                      <Server className={`w-3.5 h-3.5 ${online ? 'text-emerald-400' : 'text-gray-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{worker.name}</p>
                      {worker.capabilities?.length > 0 && (
                        <p className={`text-xs font-mono truncate ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {worker.capabilities.join(', ')}
                        </p>
                      )}
                    </div>
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${online ? 'text-emerald-400' : 'text-red-400'}`} />
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className={`flex-1 py-2 rounded-lg text-sm font-medium ${dark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className="tc-btn primary" style={{ flex: 1, height: 38, justifyContent: 'center' }}>
              {loading ? 'Creating…' : 'Create Flow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateFlowModal;
