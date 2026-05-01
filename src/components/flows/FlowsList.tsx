import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Play, Pencil, Trash2, Clock, Search,
  GitBranch, XCircle, Loader2, Calendar, AlertTriangle, Server,
  Download, Upload, Copy, RefreshCw,
} from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useWorkerStore } from '../../store/workerStore';
import { useTheme } from '../../context/ThemeContext';
import StatusBadge from './StatusBadge';
import CreateFlowModal from './CreateFlowModal';
import ScheduleModal from './ScheduleModal';
import type { OrchestratorFlow } from '../../store/flowLibraryStore';

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const StatCard: React.FC<{ label: string; value: number | string; icon: React.ElementType; color: string; dark: boolean }> = ({ label, value, icon: Icon, color, dark }) => (
  <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
    <div className="flex items-center justify-between mb-2">
      <span className={`text-xs font-medium ${dark ? 'text-gray-500' : 'text-gray-500'}`}>{label}</span>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
    </div>
    <p className="text-2xl font-bold">{value}</p>
  </div>
);

function exportFlowFile(flow: OrchestratorFlow) {
  const data = {
    name: flow.name,
    namespace: flow.namespace,
    description: flow.description,
    nodes: flow.nodes || [],
    edges: flow.edges || [],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${flow.name.replace(/\s+/g, '-')}.or`;
  a.click();
  URL.revokeObjectURL(url);
}

const FlowsList: React.FC = () => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const navigate = useNavigate();
  const { flows, executions, createFlow, deleteFlow, executeFlow, updateFlow, syncWorkerFlows } = useFlowLibraryStore();
  const { workers, statuses, getWorker } = useWorkerStore();

  const [search, setSearch] = useState('');
  const [workerFilter, setWorkerFilter] = useState<string>('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [scheduleFlow, setScheduleFlow] = useState<OrchestratorFlow | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [retrievingFlows, setRetrievingFlows] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => {}, 5000);
    return () => clearInterval(t);
  }, []);

  const filtered = flows.filter(f => {
    const w = getWorker(f.workerId);
    const matchWorker = workerFilter === 'ALL' || f.workerId === workerFilter;
    const matchSearch =
      !search ||
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.namespace.toLowerCase().includes(search.toLowerCase()) ||
      f.description?.toLowerCase().includes(search.toLowerCase()) ||
      w?.name.toLowerCase().includes(search.toLowerCase());
    return matchWorker && matchSearch;
  });

  const stats = {
    total: flows.length,
    running: flows.filter(f => f.lastExecution?.status === 'RUNNING').length,
    failed: flows.filter(f => f.lastExecution?.status === 'FAILED').length,
    scheduled: flows.filter(f => f.schedule?.enabled).length,
  };

  const handleExecute = useCallback(async (flowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const flow = flows.find(f => f.id === flowId);
    const worker = flow ? getWorker(flow.workerId) : null;
    if (!worker) return;
    setRunningIds(prev => new Set(prev).add(flowId));
    try {
      const execId = await executeFlow(flowId);
      navigate(`/flows/${flowId}?tab=executions&exec=${execId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRunningIds(prev => { const s = new Set(prev); s.delete(flowId); return s; });
    }
  }, [flows, executeFlow, getWorker, navigate]);

  const handleDelete = useCallback(async (flowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteConfirm !== flowId) {
      setDeleteConfirm(flowId);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }
    deleteFlow(flowId);
    setDeleteConfirm(null);
  }, [deleteFlow, deleteConfirm]);

  const handleCreate = useCallback(async (data: { name: string; namespace: string; description: string; workerId: string }) => {
    const flow = createFlow(data);
    navigate(`/flows/${flow.id}?tab=edit`);
  }, [createFlow, navigate]);

  const handleDuplicate = useCallback((flow: OrchestratorFlow, e: React.MouseEvent) => {
    e.stopPropagation();
    const duplicate = createFlow({
      name: `${flow.name} copy`,
      namespace: flow.namespace,
      description: flow.description,
      workerId: flow.workerId,
    });
    updateFlow(duplicate.id, {
      nodes: JSON.parse(JSON.stringify(flow.nodes || [])),
      edges: JSON.parse(JSON.stringify(flow.edges || [])),
      schedule: flow.schedule ? { ...flow.schedule } : null,
    });
    navigate(`/flows/${duplicate.id}?tab=edit`);
  }, [createFlow, updateFlow, navigate]);

  const handleScheduleSave = useCallback(async (schedule: { cron: string; enabled: boolean; timezone: string } | null) => {
    if (!scheduleFlow) return;
    updateFlow(scheduleFlow.id, { schedule: schedule ?? undefined });
    setScheduleFlow(null);
  }, [scheduleFlow, updateFlow]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const workerId = workers[0]?.id ?? '';
        const flow = createFlow({
          name: data.name || file.name.replace(/\.or$/, ''),
          namespace: data.namespace || 'default',
          description: data.description || '',
          workerId,
        });
        if (data.nodes || data.edges) {
          updateFlow(flow.id, { nodes: data.nodes || [], edges: data.edges || [] });
        }
        navigate(`/flows/${flow.id}?tab=edit`);
      } catch {
        alert('Failed to parse .or file');
      }
    };
    reader.readAsText(file);
    if (importInputRef.current) importInputRef.current.value = '';
  }, [workers, createFlow, updateFlow, navigate]);

  const handleRetrieveWorkerFlows = useCallback(async () => {
    setRetrievingFlows(true);
    try {
      const count = await syncWorkerFlows();
      if (count === 0) {
        alert('No new flows found on online workers');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to retrieve worker flows');
    } finally {
      setRetrievingFlows(false);
    }
  }, [syncWorkerFlows]);

  const workerOfFlow = (flow: OrchestratorFlow) => getWorker(flow.workerId);
  const workerStatus = (flow: OrchestratorFlow) => {
    const w = workerOfFlow(flow);
    return w ? (statuses[w.id] ?? 'unknown') : null;
  };

  return (
    <div className={`h-full flex flex-col ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div className={`px-6 py-4 border-b flex items-center justify-between flex-shrink-0 ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        <div>
          <h1 className="text-lg font-semibold">Flows</h1>
          <p className={`text-xs mt-0.5 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{flows.length} flow{flows.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".or"
            className="hidden"
            onChange={handleImport}
          />
          <button
            onClick={() => importInputRef.current?.click()}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium ${dark ? 'border-gray-700 hover:border-gray-600 text-gray-300 hover:bg-gray-800' : 'border-gray-200 hover:border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            <Upload className="w-4 h-4" />
            Import .or
          </button>
          <button
            onClick={handleRetrieveWorkerFlows}
            disabled={retrievingFlows || workers.length === 0}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 ${dark ? 'border-gray-700 hover:border-gray-600 text-gray-300 hover:bg-gray-800' : 'border-gray-200 hover:border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            title="Retrieve flows registered on online workers"
          >
            <RefreshCw className={`w-4 h-4 ${retrievingFlows ? 'animate-spin' : ''}`} />
            Retrieve
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Flow
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Flows" value={stats.total} icon={GitBranch} color="bg-purple-600/20 text-purple-400" dark={dark} />
            <StatCard label="Running" value={stats.running} icon={Loader2} color="bg-blue-600/20 text-blue-400" dark={dark} />
            <StatCard label="Failed" value={stats.failed} icon={XCircle} color="bg-red-600/20 text-red-400" dark={dark} />
            <StatCard label="Scheduled" value={stats.scheduled} icon={Calendar} color="bg-emerald-600/20 text-emerald-400" dark={dark} />
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
              <Search className={`w-4 h-4 flex-shrink-0 ${dark ? 'text-gray-500' : 'text-gray-400'}`} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search flows…"
                className={`flex-1 bg-transparent text-sm outline-none ${dark ? 'text-gray-100 placeholder-gray-600' : 'text-gray-900 placeholder-gray-400'}`}
              />
            </div>
            {workers.length > 1 && (
              <select
                value={workerFilter}
                onChange={e => setWorkerFilter(e.target.value)}
                className={`px-3 py-2 rounded-lg border text-sm ${dark ? 'bg-gray-900 border-gray-800 text-gray-300' : 'bg-white border-gray-200 text-gray-700'} focus:outline-none`}
              >
                <option value="ALL">All workers</option>
                {workers.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            )}
          </div>

          {workers.length === 0 && (
            <div className={`flex items-center gap-3 p-4 rounded-xl border ${dark ? 'bg-yellow-900/10 border-yellow-800/30' : 'bg-yellow-50 border-yellow-200'}`}>
              <Server className="w-4 h-4 text-yellow-400 flex-shrink-0" />
              <p className={`text-sm ${dark ? 'text-yellow-300' : 'text-yellow-700'}`}>
                No workers configured — flows can't execute until you add a backend worker.{' '}
                <button onClick={() => navigate('/workers')} className="underline">Add one now</button>
              </p>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className={`rounded-xl border py-16 flex flex-col items-center gap-3 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
              <div className="w-12 h-12 rounded-xl bg-purple-600/10 flex items-center justify-center">
                <GitBranch className="w-6 h-6 text-purple-400" />
              </div>
              <div className="text-center">
                <p className="font-medium text-sm">{search || workerFilter !== 'ALL' ? 'No flows match' : 'No flows yet'}</p>
                <p className={`text-xs mt-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {search || workerFilter !== 'ALL' ? 'Try a different filter' : 'Create your first flow to get started'}
                </p>
              </div>
              {!search && workerFilter === 'ALL' && (
                <button onClick={() => setShowCreate(true)} className="mt-1 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium">
                  <Plus className="w-4 h-4" />Create Flow
                </button>
              )}
            </div>
          ) : (
            <div className={`rounded-xl border overflow-hidden ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
              <table className="w-full">
                <thead>
                  <tr className={`text-xs font-medium border-b ${dark ? 'text-gray-500 border-gray-800' : 'text-gray-500 border-gray-200'}`}>
                    <th className="text-left px-4 py-3">Flow</th>
                    <th className="text-left px-4 py-3">Worker</th>
                    <th className="text-left px-4 py-3">Last Execution</th>
                    <th className="text-left px-4 py-3">Duration</th>
                    <th className="text-left px-4 py-3">Schedule</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(flow => {
                    const worker = workerOfFlow(flow);
                    const wStatus = workerStatus(flow);
                    const canRun = wStatus === 'connected';
                    return (
                      <tr
                        key={flow.id}
                        onClick={() => navigate(`/flows/${flow.id}`)}
                        className={`cursor-pointer transition-colors ${dark ? 'hover:bg-gray-800/60 border-b border-gray-800/50' : 'hover:bg-gray-50 border-b border-gray-100'}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-purple-600/15 flex items-center justify-center flex-shrink-0">
                              <GitBranch className="w-3.5 h-3.5 text-purple-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{flow.name}</p>
                              <p className={`text-xs truncate ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{flow.namespace}{flow.description ? ` · ${flow.description}` : ''}</p>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          {workers.length > 0 ? (
                            <select
                              value={flow.workerId}
                              onClick={e => e.stopPropagation()}
                              onChange={e => updateFlow(flow.id, { workerId: e.target.value })}
                              title="Flow worker"
                              className={`max-w-36 px-2 py-1 rounded-md border text-xs ${dark ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-white border-gray-200 text-gray-700'} focus:outline-none`}
                            >
                              <option key='null' value='null'>No worker</option>
                              {workers.map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>No worker</span>
                          )}
                          {false && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full" style={{ background: worker.color }} />
                              <span className={`text-xs truncate max-w-24 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{worker.name}</span>
                              {wStatus === 'disconnected' && <span className="text-xs text-red-400">●</span>}
                            </div>
                          )}
                          {false && (
                            <span className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>No worker</span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          {flow.lastExecution ? (
                            <div className="flex flex-col gap-1">
                              <StatusBadge status={flow.lastExecution.status} size="sm" />
                              <span className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>{formatRelativeTime(flow.lastExecution.startTime)}</span>
                            </div>
                          ) : (
                            <span className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>Never run</span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <span className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{formatDuration(flow.lastExecution?.duration ?? null)}</span>
                        </td>

                        <td className="px-4 py-3">
                          {flow.schedule ? (
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${flow.schedule.enabled ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                              <span className={`text-xs font-mono ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{flow.schedule.cron}</span>
                            </div>
                          ) : (
                            <span className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>—</span>
                          )}
                        </td>

                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={e => handleExecute(flow.id, e)}
                              disabled={runningIds.has(flow.id) || !canRun}
                              title={canRun ? 'Execute flow' : 'Worker offline'}
                              className={`p-1.5 rounded-md disabled:opacity-40 ${dark ? 'hover:bg-gray-700 text-gray-400 hover:text-emerald-400' : 'hover:bg-gray-100 text-gray-500 hover:text-emerald-600'}`}
                            >
                              {runningIds.has(flow.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); navigate(`/flows/${flow.id}?tab=edit`); }}
                              title="Edit flow"
                              className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-700 text-gray-400 hover:text-blue-400' : 'hover:bg-gray-100 text-gray-500 hover:text-blue-600'}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); setScheduleFlow(flow); }}
                              title="Configure schedule"
                              className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-700 text-gray-400 hover:text-orange-400' : 'hover:bg-gray-100 text-gray-500 hover:text-orange-600'}`}
                            >
                              <Clock className="w-4 h-4" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); exportFlowFile(flow); }}
                              title="Export .or file"
                              className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-700 text-gray-400 hover:text-cyan-400' : 'hover:bg-gray-100 text-gray-500 hover:text-cyan-600'}`}
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={e => handleDuplicate(flow, e)}
                              title="Duplicate flow"
                              className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-700 text-gray-400 hover:text-violet-400' : 'hover:bg-gray-100 text-gray-500 hover:text-violet-600'}`}
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              onClick={e => handleDelete(flow.id, e)}
                              title={deleteConfirm === flow.id ? 'Click again to confirm' : 'Delete flow'}
                              className={`p-1.5 rounded-md ${deleteConfirm === flow.id ? 'bg-red-500/20 text-red-400' : dark ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-500 hover:text-red-500'}`}
                            >
                              {deleteConfirm === flow.id ? <AlertTriangle className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
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

      {showCreate && <CreateFlowModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {scheduleFlow && (
        <ScheduleModal
          flow={scheduleFlow}
          onClose={() => setScheduleFlow(null)}
          onSave={handleScheduleSave}
        />
      )}
    </div>
  );
};

export default FlowsList;
