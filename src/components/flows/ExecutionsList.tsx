import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Loader2, StopCircle, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useWorkerStore } from '../../store/workerStore';
import { useTheme } from '../../context/ThemeContext';
import StatusBadge from './StatusBadge';
import type { ExecutionStatus } from '../../utils/workerApi';

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const ALL_STATUSES: ExecutionStatus[] = ['RUNNING', 'SUCCESS', 'FAILED', 'KILLED', 'QUEUED'];

const ExecutionsList: React.FC = () => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const navigate = useNavigate();
  const { executions, killExecution, clearExecutions, syncBackendExecutions } = useFlowLibraryStore();
  const { getWorker } = useWorkerStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ExecutionStatus | 'ALL'>('ALL');
  const [, setTick] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 3000);
    return () => clearInterval(t);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await syncBackendExecutions();
    } finally {
      setIsRefreshing(false);
      setTick(n => n + 1);
    }
  };

  const filtered = executions.filter(e => {
    const matchStatus = statusFilter === 'ALL' || e.status === statusFilter;
    const matchSearch = !search ||
      (e.displayName || '').toLowerCase().includes(search.toLowerCase()) ||
      e.flowName.toLowerCase().includes(search.toLowerCase()) ||
      e.namespace.toLowerCase().includes(search.toLowerCase()) ||
      e.id.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const statusCounts: Record<string, number> = { ALL: executions.length };
  for (const s of ALL_STATUSES) {
    statusCounts[s] = executions.filter(e => e.status === s).length;
  }

  return (
    <div className={`h-full flex flex-col ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div className={`px-6 py-4 border-b flex items-center justify-between flex-shrink-0 ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        <div>
          <h1 className="text-lg font-semibold">Executions</h1>
          <p className={`text-xs mt-0.5 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{executions.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => clearExecutions()}
            disabled={executions.length === 0}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-40 ${dark ? 'border-red-900/50 text-red-400 hover:bg-red-950/30' : 'border-red-200 text-red-600 hover:bg-red-50'}`}
          >
            <Trash2 className="w-4 h-4" />Clear history
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`p-2 rounded-lg disabled:opacity-50 ${dark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
            title="Refresh executions"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {(['ALL', ...ALL_STATUSES] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === s ? 'bg-purple-600 border-purple-600 text-white' : dark ? 'border-gray-700 text-gray-400 hover:border-gray-600' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
              >
                {s === 'ALL' ? 'All' : s} <span className="opacity-70">{statusCounts[s] || 0}</span>
              </button>
            ))}
          </div>

          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
            <Search className={`w-4 h-4 flex-shrink-0 ${dark ? 'text-gray-500' : 'text-gray-400'}`} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by execution, flow name, namespace, or ID..."
              className={`flex-1 bg-transparent text-sm outline-none ${dark ? 'text-gray-100 placeholder-gray-600' : 'text-gray-900 placeholder-gray-400'}`}
            />
          </div>

          {filtered.length === 0 ? (
            <div className={`rounded-xl border py-16 flex flex-col items-center gap-3 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
              <Activity className={`w-8 h-8 ${dark ? 'text-gray-700' : 'text-gray-300'}`} />
              <p className={`text-sm ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{search || statusFilter !== 'ALL' ? 'No executions match' : 'No executions yet'}</p>
            </div>
          ) : (
            <div className={`rounded-xl border overflow-hidden ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
              <table className="w-full">
                <thead>
                  <tr className={`text-xs font-medium border-b ${dark ? 'text-gray-500 border-gray-800' : 'text-gray-500 border-gray-200'}`}>
                    <th className="text-left px-4 py-3">Execution</th>
                    <th className="text-left px-4 py-3">Flow</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Worker</th>
                    <th className="text-left px-4 py-3">Trigger</th>
                    <th className="text-left px-4 py-3">Started</th>
                    <th className="text-left px-4 py-3">Duration</th>
                    <th className="text-left px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(exec => {
                    const worker = getWorker(exec.workerId);
                    return (
                      <tr
                        key={exec.id}
                        onClick={() => navigate(`/flows/${exec.flowId}?tab=executions&exec=${exec.id}`)}
                        className={`border-b text-sm cursor-pointer transition-colors ${dark ? 'border-gray-800/50 hover:bg-gray-800/50' : 'border-gray-100 hover:bg-gray-50'}`}
                      >
                        <td className="px-4 py-3">
                          <p className={`font-mono text-xs truncate ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{exec.displayName || `${exec.id.slice(0, 16)}...`}</p>
                          {exec.displayName && (
                            <p className={`font-mono text-[11px] truncate mt-0.5 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>{exec.id}</p>
                          )}
                        </td>
                        <td className="px-4 py-3"><p className="text-sm font-medium">{exec.flowName}</p><p className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>{exec.namespace}</p></td>
                        <td className="px-4 py-3"><StatusBadge status={exec.status} size="sm" /></td>
                        <td className="px-4 py-3">
                          {worker
                            ? <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full" style={{ background: worker.color }} /><span className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{worker.name}</span></div>
                            : <span className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>—</span>
                          }
                        </td>
                        <td className="px-4 py-3"><span className={`text-xs capitalize px-2 py-0.5 rounded-full border ${exec.triggeredBy === 'schedule' ? dark ? 'border-blue-800 bg-blue-900/20 text-blue-400' : 'border-blue-200 bg-blue-50 text-blue-700' : dark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'}`}>{exec.triggeredBy}</span></td>
                        <td className="px-4 py-3"><span className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{formatRelative(exec.startTime)}</span></td>
                        <td className="px-4 py-3"><span className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{formatDuration(exec.duration)}</span></td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          {exec.status === 'RUNNING' && (
                            <button onClick={() => killExecution(exec.id)} className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20">
                              <StopCircle className="w-3 h-3" />Kill
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionsList;
