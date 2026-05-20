import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Play, Pencil, Trash2, Clock, Search,
  GitBranch, Loader2, AlertTriangle,
  Download, Upload, Copy, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useServerWorkers } from '../../hooks/useServerWorkers';
import StatusBadge from './StatusBadge';
import CreateFlowModal from './CreateFlowModal';
import ScheduleModal from './ScheduleModal';
import type { OrchestratorFlow } from '../../store/flowLibraryStore';
import { useAuth } from '../../hooks/useAuth';

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
  const allFlows = useFlowLibraryStore.getState().flows;
  const resolvedNodes = (flow.nodes || []).map((node: any) => {
    if (node.data?.flowRef) {
      const ref = allFlows.find((f: any) => f.id === node.data.flowRef);
      if (ref) {
        const { flowRef, ...dataWithoutRef } = node.data;
        return { ...node, data: { ...dataWithoutRef, code: JSON.stringify({ nodes: ref.nodes || [], edges: ref.edges || [] }) } };
      }
    }
    return node;
  });
  const data = {
    name: flow.name,
    namespace: flow.namespace,
    description: flow.description,
    nodes: resolvedNodes,
    edges: flow.edges || [],
    artifacts: flow.artifacts || [],
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
  const { flows, createFlow, deleteFlow, executeFlow, updateFlow, syncBackendExecutions, loadAll } = useFlowLibraryStore();
  const { workers: serverWorkers } = useServerWorkers();
  const { canEdit, isViewer } = useAuth();

  // Live-tail backend so cron/API-trigger executions update the row badges
  // (lastExecution status / time) without a manual refresh. Polls every 5s
  // while the user is on /flows. We also re-fetch the flows themselves so
  // changes from outside the UI (e.g., a manual DB edit) appear too.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try { await syncBackendExecutions(); } catch { /* network blip */ }
      try { loadAll(); } catch { /* same */ }
    };
    const interval = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [syncBackendExecutions, loadAll]);

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [scheduleFlow, setScheduleFlow] = useState<OrchestratorFlow | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(new Set());
  const importInputRef = useRef<HTMLInputElement>(null);

  const toggleNamespace = useCallback((ns: string) => {
    setCollapsedNamespaces(prev => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns);
      else next.add(ns);
      return next;
    });
  }, []);

  const startRename = useCallback((flow: OrchestratorFlow, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(flow.id);
    setRenameValue(flow.name);
  }, []);

  const commitRename = useCallback((flowId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== flows.find(f => f.id === flowId)?.name) {
      updateFlow(flowId, { name: trimmed });
    }
    setRenamingId(null);
  }, [renameValue, flows, updateFlow]);

  const filtered = flows.filter(f => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      f.namespace.toLowerCase().includes(q) ||
      (f.description?.toLowerCase().includes(q) ?? false)
    );
  });

  // Group flows by namespace (mirrors WorkersPanel's group UX). Empty namespace
  // falls under the literal 'default' bucket so it still gets a header row.
  const groupedFlows: Record<string, OrchestratorFlow[]> = {};
  for (const f of filtered) {
    const key = f.namespace || 'default';
    (groupedFlows[key] = groupedFlows[key] || []).push(f);
  }
  const namespaceKeys = Object.keys(groupedFlows).sort((a, b) => a.localeCompare(b));

  const stats = {
    total: flows.length,
    running: flows.filter(f => f.lastExecution?.status === 'RUNNING').length,
    failed: flows.filter(f => f.lastExecution?.status === 'FAILED').length,
    scheduled: flows.filter(f => f.schedule?.enabled).length,
  };

  const handleExecute = useCallback(async (flowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRunningIds(prev => new Set(prev).add(flowId));
    try {
      const execId = await executeFlow(flowId);
      navigate(`/flows/${flowId}?tab=executions&exec=${execId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRunningIds(prev => { const s = new Set(prev); s.delete(flowId); return s; });
    }
  }, [executeFlow, navigate]);

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
        const flow = createFlow({
          name: data.name || file.name.replace(/\.or$/, ''),
          namespace: data.namespace || 'default',
          description: data.description || '',
          workerId: '',
        });
        if (data.nodes || data.edges || data.artifacts) {
          updateFlow(flow.id, { nodes: data.nodes || [], edges: data.edges || [], artifacts: data.artifacts || [] });
        }
        navigate(`/flows/${flow.id}?tab=edit`);
      } catch {
        alert('Failed to parse .or file');
      }
    };
    reader.readAsText(file);
    if (importInputRef.current) importInputRef.current.value = '';
  }, [createFlow, updateFlow, navigate]);

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
        {canEdit && (
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
            <button className="tc-btn primary" onClick={() => setShowCreate(true)}>
              <Plus size={13} />New Flow
            </button>
          </div>
        )}
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
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="tc-card">
          <div className="tc-empty">
            {search ? `no flows match "${search}"` : 'no flows yet — create your first flow to get started'}
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
              {namespaceKeys.flatMap(ns => {
                const isCollapsed = collapsedNamespaces.has(ns);
                const nsFlows = groupedFlows[ns];
                const header = (
                  <tr
                    key={`__ns_${ns}`}
                    className="tc-ns-header"
                    onClick={() => toggleNamespace(ns)}
                    style={{ cursor: 'pointer', background: 'var(--surface-2)' }}
                  >
                    <td colSpan={6} style={{ padding: '8px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {isCollapsed ? <ChevronRight size={13} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={13} style={{ color: 'var(--text-3)' }} />}
                        <span style={{ color: 'var(--accent)' }}>[{ns}]</span>
                        <span style={{ color: 'var(--text-3)' }}>{nsFlows.length} flow{nsFlows.length !== 1 ? 's' : ''}</span>
                      </div>
                    </td>
                  </tr>
                );
                if (isCollapsed) return [header];
                const rows = nsFlows.map(flow => {
                const canRun = true;
                return (
                  <tr key={flow.id} onClick={() => navigate(`/flows/${flow.id}?tab=executions`)}>
                    <td>
                      <div className="tc-flow-cell">
                        <span className="tc-flow-icon"><GitBranch size={14} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {renamingId === flow.id ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onBlur={() => commitRename(flow.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitRename(flow.id);
                                if (e.key === 'Escape') setRenamingId(null);
                              }}
                              onClick={e => e.stopPropagation()}
                              style={{ background: 'var(--bg-3)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: '2px 6px', width: '100%' }}
                            />
                          ) : (
                            <div
                              className="tc-flow-name"
                              onClick={e => e.stopPropagation()}
                              onDoubleClick={canEdit ? e => startRename(flow, e) : undefined}
                              title={canEdit ? 'Double-click to rename' : undefined}
                            >{flow.name}</div>
                          )}
                          <div className="tc-flow-ns">{flow.namespace}{flow.description ? ` · ${flow.description}` : ''}</div>
                        </div>
                      </div>
                    </td>

                    <td>
                      {isViewer ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                          {serverWorkers.find(w => w._id === flow.workerId)?.name ?? 'Server (default)'}
                        </span>
                      ) : (
                        (() => {
                          const grouped = serverWorkers.reduce((acc, w) => {
                            const g = w.group || '';
                            (acc[g] = acc[g] || []).push(w);
                            return acc;
                          }, {} as Record<string, typeof serverWorkers>);
                          const ungrouped = grouped[''] || [];
                          const namedGroups = Object.keys(grouped).filter(k => k !== '').sort();
                          return (
                            <select
                              className="tc-worker-select"
                              value={flow.workerId || ''}
                              onClick={e => e.stopPropagation()}
                              onChange={e => { e.stopPropagation(); updateFlow(flow.id, { workerId: e.target.value }); }}
                              title="Assign worker (server)"
                            >
                              <option value="">Server (default)</option>
                              {ungrouped.map(w => (
                                <option key={w._id} value={w._id} disabled={w.status !== 'online'}>
                                  {w.name}{w.status !== 'online' ? ' · offline' : ''}
                                </option>
                              ))}
                              {namedGroups.map(g => (
                                <optgroup key={g} label={g}>
                                  {(grouped[g] || []).map(w => (
                                    <option key={w._id} value={w._id} disabled={w.status !== 'online'}>
                                      {w.name}{w.status !== 'online' ? ' · offline' : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          );
                        })()
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
                        {canEdit && (
                          <button
                            className="tc-icon-btn"
                            onClick={e => handleExecute(flow.id, e)}
                            disabled={runningIds.has(flow.id) || !canRun}
                            title="Execute flow"
                          >
                            {runningIds.has(flow.id) ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                          </button>
                        )}
                        {canEdit && (
                          <button
                            className="tc-icon-btn"
                            onClick={e => { e.stopPropagation(); navigate(`/flows/${flow.id}?tab=edit`); }}
                            title="Edit flow"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            className="tc-icon-btn"
                            onClick={e => { e.stopPropagation(); setScheduleFlow(flow); }}
                            title="Configure schedule"
                          >
                            <Clock size={14} />
                          </button>
                        )}
                        <button
                          className="tc-icon-btn"
                          onClick={e => { e.stopPropagation(); exportFlowFile(flow); }}
                          title="Export .or file"
                        >
                          <Download size={14} />
                        </button>
                        {canEdit && (
                          <button
                            className="tc-icon-btn"
                            onClick={e => handleDuplicate(flow, e)}
                            title="Duplicate flow"
                          >
                            <Copy size={14} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            className={`tc-icon-btn${deleteConfirm === flow.id ? ' danger' : ''}`}
                            onClick={e => handleDelete(flow.id, e)}
                            title={deleteConfirm === flow.id ? 'Click again to confirm' : 'Delete flow'}
                          >
                            {deleteConfirm === flow.id ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
                });
                return [header, ...rows];
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
