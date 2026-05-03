import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Play, Pencil, Trash2, Clock, Search,
  GitBranch, XCircle, Loader2, Calendar, AlertTriangle,
  Download, Upload, Copy, RefreshCw,
} from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useWorkerStore } from '../../store/workerStore';
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

  const workerStatus = (flow: OrchestratorFlow) => {
    const w = getWorker(flow.workerId);
    return w ? (statuses[w.id] ?? 'unknown') : null;
  };

  return (
    <div className="tc-page">
      {/* Page header */}
      <div className="tc-page-header">
        <div className="tc-page-title">
          <h1>
            <span className="br">&lt;</span>
            <span className="name">Flows</span>
            <span className="slash"> /&gt;</span>
          </h1>
          <span className="subtitle">
            <span className="num">{flows.length}</span> flow{flows.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="tc-toolbar">
          <input
            ref={importInputRef}
            type="file"
            accept=".or"
            className="hidden"
            onChange={handleImport}
          />
          <button className="tc-btn ghost" onClick={() => importInputRef.current?.click()}>
            <Upload size={13} />Import .or
          </button>
          <button
            className="tc-btn ghost"
            onClick={handleRetrieveWorkerFlows}
            disabled={retrievingFlows || workers.length === 0}
            title="Retrieve flows registered on online workers"
          >
            <RefreshCw size={13} className={retrievingFlows ? 'animate-spin' : ''} />
            Retrieve
          </button>
          <button className="tc-btn primary" onClick={() => setShowCreate(true)}>
            <Plus size={13} />New Flow
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="tc-stats">
        <div className="tc-stat">
          <span className="tc-stat-label">total</span>
          <span className="tc-stat-value accent">{stats.total}</span>
        </div>
        <div className="tc-stat">
          <span className="tc-stat-label">running</span>
          <span className="tc-stat-value warn">{stats.running}</span>
        </div>
        <div className="tc-stat">
          <span className="tc-stat-label">failed (24h)</span>
          <span className="tc-stat-value err">{stats.failed}</span>
        </div>
        <div className="tc-stat">
          <span className="tc-stat-label">scheduled</span>
          <span className="tc-stat-value">{stats.scheduled}</span>
        </div>
      </div>

      {/* Search */}
      <div className="tc-search">
        <span className="icon"><Search size={14} /></span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search flows by name, namespace, or tag…"
        />
        {workers.length > 1 && (
          <select
            value={workerFilter}
            onChange={e => setWorkerFilter(e.target.value)}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', color: 'var(--text-3)',
              fontFamily: 'var(--font-mono)', fontSize: 11, outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="ALL">All workers</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="tc-card">
          <div className="tc-empty">
            {search || workerFilter !== 'ALL' ? `no flows match "${search}"` : 'no flows yet — create your first flow to get started'}
          </div>
        </div>
      ) : (
        <div className="tc-card">
          <table className="tc-table">
            <thead>
              <tr>
                <th>Flow</th>
                <th>Worker</th>
                <th>Last Execution</th>
                <th>Duration</th>
                <th>Schedule</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(flow => {
                const wStatus = workerStatus(flow);
                const canRun = wStatus === 'connected';
                return (
                  <tr key={flow.id} onClick={() => navigate(`/flows/${flow.id}`)}>
                    <td>
                      <div className="tc-flow-cell">
                        <span className="tc-flow-icon"><GitBranch size={14} /></span>
                        <div>
                          <div className="tc-flow-name">{flow.name}</div>
                          <div className="tc-flow-ns">{flow.namespace}{flow.description ? ` · ${flow.description}` : ''}</div>
                        </div>
                      </div>
                    </td>

                    <td>
                      {workers.length > 0 ? (
                        <select
                          className="tc-worker-select"
                          value={flow.workerId}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); updateFlow(flow.id, { workerId: e.target.value }); }}
                          title="Flow worker"
                        >
                          <option value="null">No worker</option>
                          {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      ) : (
                        <span className="tc-dash">—</span>
                      )}
                    </td>

                    <td>
                      {flow.lastExecution ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <StatusBadge status={flow.lastExecution.status} />
                          <span className="tc-reltime">{formatRelativeTime(flow.lastExecution.startTime)}</span>
                        </div>
                      ) : (
                        <span className="tc-dash">—</span>
                      )}
                    </td>

                    <td>
                      <span className="tc-duration">
                        {formatDuration(flow.lastExecution?.duration ?? null)}
                      </span>
                    </td>

                    <td>
                      {flow.schedule ? (
                        <span className="tc-sched-pill">
                          <span className={`tc-sched-dot${flow.schedule.enabled ? '' : ' disabled'}`} />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
                            {flow.schedule.cron}
                          </span>
                        </span>
                      ) : (
                        <span className="tc-dash">—</span>
                      )}
                    </td>

                    <td onClick={e => e.stopPropagation()}>
                      <div className="tc-row-actions">
                        <button
                          className="tc-icon-btn"
                          onClick={e => handleExecute(flow.id, e)}
                          disabled={runningIds.has(flow.id) || !canRun}
                          title={canRun ? 'Execute flow' : 'Worker offline'}
                        >
                          {runningIds.has(flow.id) ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                        </button>
                        <button
                          className="tc-icon-btn"
                          onClick={e => { e.stopPropagation(); navigate(`/flows/${flow.id}?tab=edit`); }}
                          title="Edit flow"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="tc-icon-btn"
                          onClick={e => { e.stopPropagation(); setScheduleFlow(flow); }}
                          title="Configure schedule"
                        >
                          <Clock size={14} />
                        </button>
                        <button
                          className="tc-icon-btn"
                          onClick={e => { e.stopPropagation(); exportFlowFile(flow); }}
                          title="Export .or file"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          className="tc-icon-btn"
                          onClick={e => handleDuplicate(flow, e)}
                          title="Duplicate flow"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          className={`tc-icon-btn${deleteConfirm === flow.id ? ' danger' : ''}`}
                          onClick={e => handleDelete(flow.id, e)}
                          title={deleteConfirm === flow.id ? 'Click again to confirm' : 'Delete flow'}
                        >
                          {deleteConfirm === flow.id ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
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
