import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Play, Pencil, Trash2, Clock, Search,
  GitBranch, Loader2, AlertTriangle,
  Download, Upload, Copy, ChevronDown, ChevronRight,
  CornerDownRight,
} from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useServerWorkers, canUseWorker } from '../../hooks/useServerWorkers';
import BranchSelect from './BranchSelect';
import StatusBadge from './StatusBadge';
import CreateFlowModal from './CreateFlowModal';
import ScheduleModal from './ScheduleModal';
import type { OrchestratorFlow } from '../../store/flowLibraryStore';
import type { FlowVariant } from '../../types/flows';
import { useAuth } from '../../hooks/useAuth';
import { apiClient } from '../../utils/apiClient';

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
  const { flows, executions, loaded, createFlow, deleteFlow, executeFlow, updateFlow, syncBackendExecutions, loadAll } = useFlowLibraryStore();
  const { workers: serverWorkers } = useServerWorkers();
  const { canEdit, isViewer, role, login, isAdmin } = useAuth();
  const [users, setUsers] = useState<Array<{ _id: string; login: string; role: string }>>([]);
  useEffect(() => {
    if (!canEdit) return;
    apiClient.get('/api/v1/users').then((data: any) => {
      setUsers(Array.isArray(data) ? data : []);
    }).catch(() => { /* operator may still get users; ignore errors */ });
  }, [canEdit]);
  const adminLogins = useMemo(
    () => new Set(users.filter(u => u.role === 'admin').map(u => u.login)),
    [users],
  );
  const canEditFlow = useCallback((flow: OrchestratorFlow): boolean => {
    if (!canEdit) return false;
    if (isAdmin) return true;
    // operator: cannot edit a flow owned by an admin
    if (flow.owner && adminLogins.has(flow.owner)) return false;
    return true;
  }, [canEdit, isAdmin, adminLogins]);
  void role;

  // Live-tail backend so cron/API-trigger executions update the row badges
  // (lastExecution status / time) without a manual refresh. Polls every 5s
  // while the user is on /flows. We also re-fetch the flows themselves so
  // changes from outside the UI (e.g., a manual DB edit) appear too.
  //
  // The first tick runs immediately on mount. App.tsx only calls loadAll()
  // when a JWT already exists at app-mount time; after a fresh login the
  // effect there has already run (and bailed), so without this the list
  // stayed on "no flows yet" until the first 5s interval fired.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try { await syncBackendExecutions(); } catch { /* network blip */ }
      try { loadAll(); } catch { /* same */ }
    };
    tick();
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
  const [renamingNsId, setRenamingNsId] = useState<string | null>(null);
  const [renameNsValue, setRenameNsValue] = useState('');
  const [renamingOwnerId, setRenamingOwnerId] = useState<string | null>(null);
  const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(new Set());
  const [scheduleVariant, setScheduleVariant] = useState<{ flow: OrchestratorFlow; variant: FlowVariant } | null>(null);
  // Cron schedules keyed by flowId, so each row (flow or subrow) can show the
  // schedule proper to its own worker/branch config. Admin-only endpoint.
  const [schedulesByFlow, setSchedulesByFlow] = useState<Record<string, any[]>>({});
  const importInputRef = useRef<HTMLInputElement>(null);

  const reloadSchedules = useCallback(() => {
    if (!isAdmin) return;
    apiClient.get('/api/v1/schedules').then((data: any) => {
      const rows: any[] = data?.schedules || [];
      const byFlow: Record<string, any[]> = {};
      for (const s of rows) (byFlow[s.flowId] = byFlow[s.flowId] || []).push(s);
      setSchedulesByFlow(byFlow);
    }).catch(() => { /* non-fatal */ });
  }, [isAdmin]);
  useEffect(() => { reloadSchedules(); }, [reloadSchedules]);

  // Most-recent execution matching a specific worker/branch config.
  const lastExecFor = useCallback((flowId: string, workerId: string, branch: string) => {
    let best: typeof executions[number] | null = null;
    for (const e of executions) {
      if (e.flowId !== flowId) continue;
      if ((e.workerId || '') !== (workerId || '')) continue;
      if ((e.branch || 'main') !== (branch || 'main')) continue;
      if (!best || new Date(e.startTime).getTime() > new Date(best.startTime).getTime()) best = e;
    }
    return best;
  }, [executions]);

  // Cron schedule row for a flow config: flow-level (variantId absent) or a
  // specific variant. Returns the cron row or null.
  const scheduleFor = useCallback((flowId: string, variantId: string | null) => {
    const rows = schedulesByFlow[flowId] || [];
    return rows.find((s: any) => s.type === 'cron' && (variantId ? s.variantId === variantId : !s.variantId)) || null;
  }, [schedulesByFlow]);

  const genVariantId = () => `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const addVariant = useCallback((flow: OrchestratorFlow) => {
    const v: FlowVariant = { id: genVariantId(), workerId: flow.workerId || '', branch: flow.activeBranch || 'main' };
    updateFlow(flow.id, { variants: [...(flow.variants || []), v] });
  }, [updateFlow]);

  const patchVariant = useCallback((flow: OrchestratorFlow, variantId: string, patch: Partial<FlowVariant>) => {
    updateFlow(flow.id, { variants: (flow.variants || []).map(v => v.id === variantId ? { ...v, ...patch } : v) });
  }, [updateFlow]);

  const removeVariant = useCallback((flow: OrchestratorFlow, variantId: string) => {
    updateFlow(flow.id, { variants: (flow.variants || []).filter(v => v.id !== variantId) });
  }, [updateFlow]);

  const executeVariant = useCallback(async (flow: OrchestratorFlow, variant: FlowVariant) => {
    const key = `${flow.id}:${variant.id}`;
    setRunningIds(prev => new Set(prev).add(key));
    try {
      const execId = await executeFlow(flow.id, 'manual', { workerId: variant.workerId, branch: variant.branch });
      navigate(`/flows/${flow.id}?tab=executions&exec=${execId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRunningIds(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, [executeFlow, navigate]);

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

  const startRenameNs = useCallback((flow: OrchestratorFlow, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingNsId(flow.id);
    setRenameNsValue(flow.namespace || 'default');
  }, []);

  const commitRenameNs = useCallback((flowId: string) => {
    const trimmed = renameNsValue.trim();
    if (trimmed && trimmed !== (flows.find(f => f.id === flowId)?.namespace || 'default')) {
      updateFlow(flowId, { namespace: trimmed });
    }
    setRenamingNsId(null);
  }, [renameNsValue, flows, updateFlow]);

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
    // If the duplicating user can't use the source flow's worker, drop the
    // assignment: server (local) is always authorized. Falls through to the
    // first authorized online worker only if some future policy forbids server.
    let dupWorkerId = flow.workerId || '';
    if (dupWorkerId) {
      const srcWorker = serverWorkers.find(w => w._id === dupWorkerId);
      if (!srcWorker || !canUseWorker(srcWorker, role, login)) {
        dupWorkerId = '';
      }
    }
    const duplicate = createFlow({
      name: `${flow.name} copy`,
      namespace: flow.namespace,
      description: flow.description,
      workerId: dupWorkerId,
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
            {search ? (
              <><span className="num">{filtered.length}</span> of {flows.length} flow{flows.length !== 1 ? 's' : ''}</>
            ) : (
              <><span className="num">{flows.length}</span> flow{flows.length !== 1 ? 's' : ''}</>
            )}
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
            {!loaded && flows.length === 0
              ? 'loading flows…'
              : search
                ? `no flows match "${search}"`
                : 'no flows yet — create your first flow to get started'}
          </div>
        </div>
      ) : (
        <div className="tc-card">
          <table className="tc-table">
            <thead>
              <tr>
                <th>Flow</th>
                <th>Branch</th>
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
                    <td colSpan={7} style={{ padding: '8px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {isCollapsed ? <ChevronRight size={13} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={13} style={{ color: 'var(--text-3)' }} />}
                        <span style={{ color: 'var(--accent)' }}>[{ns}]</span>
                        <span style={{ color: 'var(--text-3)' }}>{nsFlows.length} flow{nsFlows.length !== 1 ? 's' : ''}</span>
                      </div>
                    </td>
                  </tr>
                );
                if (isCollapsed) return [header];
                const rows = nsFlows.flatMap(flow => {
                const canRun = true;
                const variants = flow.variants || [];
                const subUsableWorkers = serverWorkers.filter(w => canUseWorker(w, role, login));
                const mainRow = (
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
                              onDoubleClick={canEditFlow(flow) ? e => startRename(flow, e) : undefined}
                              title={canEditFlow(flow) ? 'Double-click to rename' : undefined}
                            >{flow.name}</div>
                          )}
                          <div className="tc-flow-ns">
                            {renamingNsId === flow.id ? (
                              <input
                                autoFocus
                                value={renameNsValue}
                                onChange={e => setRenameNsValue(e.target.value)}
                                onBlur={() => commitRenameNs(flow.id)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitRenameNs(flow.id);
                                  if (e.key === 'Escape') setRenamingNsId(null);
                                }}
                                onClick={e => e.stopPropagation()}
                                style={{ background: 'var(--bg-3)', border: '1px solid var(--accent)', borderRadius: 3, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '1px 4px', width: 140 }}
                              />
                            ) : (
                              <span
                                onClick={e => e.stopPropagation()}
                                onDoubleClick={canEditFlow(flow) ? e => startRenameNs(flow, e) : undefined}
                                title={canEditFlow(flow) ? 'Double-click to rename namespace' : undefined}
                                style={{ cursor: canEditFlow(flow) ? 'text' : undefined }}
                              >
                                {flow.namespace}
                              </span>
                            )}
                            {' · '}
                            {renamingOwnerId === flow.id ? (
                              <select
                                autoFocus
                                value={flow.owner || ''}
                                onClick={e => e.stopPropagation()}
                                onChange={e => {
                                  const newOwner = e.target.value;
                                  if (newOwner && newOwner !== flow.owner) updateFlow(flow.id, { owner: newOwner });
                                  setRenamingOwnerId(null);
                                }}
                                onBlur={() => setRenamingOwnerId(null)}
                                style={{ background: 'var(--bg-3)', border: '1px solid var(--accent)', borderRadius: 3, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '1px 4px' }}
                              >
                                {users.filter(u => u.role !== 'viewer').map(u => (
                                  <option key={u._id} value={u.login}>{u.login} ({u.role})</option>
                                ))}
                              </select>
                            ) : (
                              <span
                                onClick={e => e.stopPropagation()}
                                onDoubleClick={isAdmin ? e => { e.stopPropagation(); setRenamingOwnerId(flow.id); } : undefined}
                                title={isAdmin ? 'Double-click to change owner' : undefined}
                                style={{ cursor: isAdmin ? 'pointer' : undefined, color: 'var(--text-3)' }}
                              >
                                by {flow.owner || '—'}
                              </span>
                            )}
                            {flow.description ? ` · ${flow.description}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="Active git branch">
                        <GitBranch size={12} style={{ color: 'var(--text-3)' }} />
                        {canEditFlow(flow) ? (
                          <BranchSelect
                            flowId={flow.id}
                            activeBranch={flow.activeBranch}
                            onChanged={() => loadAll()}
                            style={{
                              height: 26, padding: '0 6px', borderRadius: 5,
                              background: 'var(--bg-2)', color: 'var(--text)',
                              border: '1px solid var(--border)', fontSize: 11,
                              fontFamily: 'var(--font-mono)', cursor: 'pointer', maxWidth: 130,
                            }}
                          />
                        ) : (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{flow.activeBranch || 'main'}</span>
                        )}
                      </div>
                    </td>

                    <td>
                      {!canEditFlow(flow) ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                          {serverWorkers.find(w => w._id === flow.workerId)?.name ?? 'Server (default)'}
                        </span>
                      ) : (
                        (() => {
                          // Only workers the user may run on (plus the assigned one).
                          const usableWorkers = serverWorkers.filter(w => canUseWorker(w, role, login) || w._id === flow.workerId);
                          const grouped = usableWorkers.reduce((acc, w) => {
                            const g = w.group || '';
                            (acc[g] = acc[g] || []).push(w);
                            return acc;
                          }, {} as Record<string, typeof usableWorkers>);
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

                    {(() => {
                      const le = lastExecFor(flow.id, flow.workerId || '', flow.activeBranch || 'main');
                      const sched = scheduleFor(flow.id, null);
                      return (
                        <>
                          <td>
                            {le ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <StatusBadge status={le.status} />
                                <span className="tc-reltime">{formatRelativeTime(le.startTime)}</span>
                              </div>
                            ) : (
                              <span className="tc-dash">—</span>
                            )}
                          </td>
                          <td>
                            <span className="tc-duration">{formatDuration(le?.duration ?? null)}</span>
                          </td>
                          <td>
                            {sched ? (
                              <span className="tc-sched-pill">
                                <span className={`tc-sched-dot${sched.enabled ? '' : ' disabled'}`} />
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>{sched.cronExpr}</span>
                              </span>
                            ) : flow.schedule ? (
                              <span className="tc-sched-pill">
                                <span className={`tc-sched-dot${flow.schedule.enabled ? '' : ' disabled'}`} />
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>{flow.schedule.cron}</span>
                              </span>
                            ) : (
                              <span className="tc-dash">—</span>
                            )}
                          </td>
                        </>
                      );
                    })()}

                    <td onClick={e => e.stopPropagation()}>
                      <div className="tc-row-actions">
                        {!isViewer && (
                          <button
                            className="tc-icon-btn"
                            onClick={e => handleExecute(flow.id, e)}
                            disabled={runningIds.has(flow.id) || !canRun}
                            title="Execute flow"
                          >
                            {runningIds.has(flow.id) ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                          </button>
                        )}
                        {canEditFlow(flow) && (
                          <button
                            className="tc-icon-btn"
                            onClick={e => { e.stopPropagation(); addVariant(flow); }}
                            title="Add subrow (variant)"
                          >
                            <Plus size={14} />
                          </button>
                        )}
                        {canEditFlow(flow) && (
                          <button
                            className="tc-icon-btn"
                            onClick={e => { e.stopPropagation(); navigate(`/flows/${flow.id}?tab=edit`); }}
                            title="Edit flow"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canEditFlow(flow) && isAdmin && (
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
                        {canEditFlow(flow) && (
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
                const subRows = [
                  ...variants.map(variant => {
                    const runKey = `${flow.id}:${variant.id}`;
                    const editable = canEditFlow(flow);
                    const le = lastExecFor(flow.id, variant.workerId || '', variant.branch || 'main');
                    const sched = scheduleFor(flow.id, variant.id);
                    return (
                      <tr key={runKey} onClick={e => e.stopPropagation()}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 30 }}>
                            <CornerDownRight size={13} style={{ color: 'var(--text-3)' }} />
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>variant</span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="Subrow git branch">
                            <GitBranch size={12} style={{ color: 'var(--text-3)' }} />
                            {editable ? (
                              <BranchSelect
                                flowId={flow.id}
                                activeBranch={variant.branch}
                                onSelect={b => patchVariant(flow, variant.id, { branch: b })}
                                style={{
                                  height: 26, padding: '0 6px', borderRadius: 5,
                                  background: 'var(--bg-2)', color: 'var(--text)',
                                  border: '1px solid var(--border)', fontSize: 11,
                                  fontFamily: 'var(--font-mono)', cursor: 'pointer', maxWidth: 130,
                                }}
                              />
                            ) : (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{variant.branch}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          {editable ? (
                            <select
                              className="tc-worker-select"
                              value={variant.workerId || ''}
                              onClick={e => e.stopPropagation()}
                              onChange={e => { e.stopPropagation(); patchVariant(flow, variant.id, { workerId: e.target.value }); }}
                              title="Subrow worker"
                            >
                              <option value="">Server (default)</option>
                              {subUsableWorkers.map(w => (
                                <option key={w._id} value={w._id} disabled={w.status !== 'online'}>
                                  {w.name}{w.status !== 'online' ? ' · offline' : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                              {serverWorkers.find(w => w._id === variant.workerId)?.name ?? 'Server (default)'}
                            </span>
                          )}
                        </td>
                        <td>
                          {le ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <StatusBadge status={le.status} />
                              <span className="tc-reltime">{formatRelativeTime(le.startTime)}</span>
                            </div>
                          ) : (
                            <span className="tc-dash">—</span>
                          )}
                        </td>
                        <td>
                          <span className="tc-duration">{formatDuration(le?.duration ?? null)}</span>
                        </td>
                        <td>
                          {sched ? (
                            <span className="tc-sched-pill">
                              <span className={`tc-sched-dot${sched.enabled ? '' : ' disabled'}`} />
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>{sched.cronExpr}</span>
                            </span>
                          ) : (
                            <span className="tc-dash">—</span>
                          )}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="tc-row-actions">
                            {!isViewer && (
                              <button
                                className="tc-icon-btn"
                                disabled={runningIds.has(runKey)}
                                onClick={e => { e.stopPropagation(); executeVariant(flow, variant); }}
                                title="Execute subrow"
                              >
                                {runningIds.has(runKey) ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                              </button>
                            )}
                            {isAdmin && editable && (
                              <button
                                className="tc-icon-btn"
                                onClick={e => { e.stopPropagation(); setScheduleVariant({ flow, variant }); }}
                                title="Schedule / API trigger for this subrow"
                              >
                                <Clock size={14} />
                              </button>
                            )}
                            {editable && (
                              <button
                                className="tc-icon-btn danger"
                                onClick={e => { e.stopPropagation(); removeVariant(flow, variant.id); }}
                                title="Remove subrow"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }),
                ].filter(Boolean);
                return [mainRow, ...subRows];
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
          onClose={() => { setScheduleFlow(null); reloadSchedules(); }}
          onSave={handleScheduleSave}
        />
      )}
      {scheduleVariant && (
        <ScheduleModal
          flow={scheduleVariant.flow}
          variant={scheduleVariant.variant}
          onClose={() => { setScheduleVariant(null); reloadSchedules(); }}
          onSave={async () => { reloadSchedules(); }}
        />
      )}
    </div>
  );
};

export default FlowsList;
