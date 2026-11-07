import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Trash2, Eye, Play, Loader2, GitBranch } from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import StatusBadge from './StatusBadge';
import ExecIdCell from './ExecIdCell';
import ExecutionsChart from './ExecutionsChart';
import type { ExecutionStatus } from '../../types/flows';
import { useAuth } from '../../hooks/useAuth';
import { useServerWorkers, canUseWorker } from '../../hooks/useServerWorkers';
import { executionColumns, useFilters, applyFilters, FilterHeader, ActiveFilters, looksLikeIp } from '../filters/columnFilters';
import type { FlowExecution } from '../../types/flows';

const COLS = executionColumns<FlowExecution>();
const COL_LIST = [COLS.id, COLS.flow, COLS.status, COLS.worker, COLS.branch, COLS.trigger, COLS.by, COLS.started, COLS.duration];

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
const CHIP_LABELS: Record<string, string> = {
  ALL: 'All', RUNNING: 'Running', SUCCESS: 'Success',
  FAILED: 'Failed', KILLED: 'Killed', QUEUED: 'Queued',
};

const ExecutionsList: React.FC = () => {
  const navigate = useNavigate();
  const { executions, killExecution, clearExecutions, deleteExecution, syncBackendExecutions, executeFlow } = useFlowLibraryStore();
  const { canEdit, isAdmin, role, login } = useAuth();
  const { workers: serverWorkers } = useServerWorkers();

  // May the user re-run on the worker this execution used? (server always ok)
  const canRunExec = (exec: { workerId?: string }) => {
    if (!exec.workerId) return true;
    const w = serverWorkers.find(sw => sw._id === exec.workerId);
    return !!w && canUseWorker(w, role, login);
  };

  // Who may delete a single execution: admins delete any; operators delete only
  // the ones they triggered (exec.triggeredUser === their login). Mirrors the
  // server-side rule in routes/executions.ts.
  const canDeleteExec = (exec: { triggeredUser?: string | null; status: ExecutionStatus }) =>
    exec.status !== 'RUNNING' && (isAdmin || (role === 'operator' && !!login && exec.triggeredUser === login));

  const [search, setSearch] = useState('');
  const { filters, setFilter, clearAll } = useFilters();
  const statusSel = filters.status?.kind === 'facet' ? filters.status.values : [];
  const statusFilter: ExecutionStatus | 'ALL' | 'MIXED' = statusSel.length === 0 ? 'ALL' : statusSel.length === 1 ? statusSel[0] as ExecutionStatus : 'MIXED';
  const setStatusFilter = (s: ExecutionStatus | 'ALL') => setFilter('status', s === 'ALL' ? undefined : { kind: 'facet', values: [s] });
  const [, setTick] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const handleDelete = async (execId: string) => {
    if (!confirm('Delete this execution? This cannot be undone.')) return;
    try {
      await deleteExecution(execId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleRerun = async (exec: { id: string; flowId: string; workerId?: string; branch?: string }) => {
    setRerunningId(exec.id);
    try {
      // Re-run the same flow on the same worker + branch the original used.
      const execId = await executeFlow(exec.flowId, 'manual', { workerId: exec.workerId || '', branch: exec.branch });
      navigate(`/flows/${exec.flowId}?tab=executions&exec=${execId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRerunningId(null);
    }
  };

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

  const searched = executions.filter(e => {
    const matchSearch = !search ||
      (e.displayName || '').toLowerCase().includes(search.toLowerCase()) ||
      e.flowName.toLowerCase().includes(search.toLowerCase()) ||
      e.namespace.toLowerCase().includes(search.toLowerCase()) ||
      e.id.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });
  const filtered = applyFilters(searched, COL_LIST, filters);
  const fh = { rows: searched, cols: COL_LIST, filters, setFilter };

  const statusCounts: Record<string, number> = { ALL: executions.length };
  for (const s of ALL_STATUSES) {
    statusCounts[s] = executions.filter(e => e.status === s).length;
  }

  return (
    <div className="tc-page">
      {/* Page header */}
      <div className="tc-page-header">
        <div className="tc-page-title">
          <h1>
            <span className="br">&lt;</span>
            <span className="name">Executions</span>
            <span className="slash"> /&gt;</span>
          </h1>
          <span className="subtitle">
            <span className="num">{executions.length}</span> total
          </span>
        </div>
        <div className="tc-toolbar">
          {isAdmin && (
            <button
              className={`tc-btn${clearConfirm ? ' danger' : ''}`}
              onClick={() => {
                if (!clearConfirm) {
                  setClearConfirm(true);
                  setTimeout(() => setClearConfirm(false), 3000);
                } else {
                  clearExecutions();
                  setClearConfirm(false);
                }
              }}
              disabled={executions.length === 0}
              title={clearConfirm ? 'Click again to confirm' : 'Clear execution history'}
            >
              <Trash2 size={13} />{clearConfirm ? 'Confirm clear?' : 'Clear history'}
            </button>
          )}
          <button
            className="tc-btn ghost"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh executions"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="tc-chips">
        {(['ALL', ...ALL_STATUSES] as const).map(s => (
          <button
            key={s}
            className={`tc-chip${statusFilter === s ? ' active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {CHIP_LABELS[s]}
            <span className="count">{statusCounts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="tc-search">
        <span className="icon"><Search size={14} /></span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by execution ID, flow name, namespace…"
        />
      </div>

      <ActiveFilters cols={COL_LIST} filters={filters} setFilter={setFilter} clearAll={clearAll} total={searched.length} shown={filtered.length} />

      {/* Chart for current filter */}
      {filtered.length > 0 && <ExecutionsChart executions={filtered} />}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="tc-card">
          <div className="tc-empty">
            {search || filtered.length !== executions.length ? <>no executions match the current filters · <button className="tc-filter-link" onClick={() => { clearAll(); setSearch(''); }}>clear filters</button></> : 'no executions yet'}
          </div>
        </div>
      ) : (
        <div className="tc-card">
          <table className="tc-table">
            <thead>
              <tr>
                <th><FilterHeader col={COLS.id} {...fh} /></th>
                <th><FilterHeader col={COLS.flow} {...fh} /></th>
                <th><FilterHeader col={COLS.status} {...fh} /></th>
                <th><FilterHeader col={COLS.worker} {...fh} /></th>
                <th><FilterHeader col={COLS.branch} {...fh} /></th>
                <th><FilterHeader col={COLS.trigger} {...fh} /></th>
                <th><FilterHeader col={COLS.by} {...fh} /></th>
                <th><FilterHeader col={COLS.started} {...fh} /></th>
                <th><FilterHeader col={COLS.duration} {...fh} /></th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(exec => {
                return (
                  <tr
                    key={exec.id}
                    onClick={() => navigate(`/flows/${exec.flowId}?tab=executions&exec=${exec.id}`)}
                  >
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <ExecIdCell id={exec.id} />
                        {exec.displayName && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                            {exec.displayName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="tc-flow-name">{exec.flowName}</div>
                      <div className="tc-flow-ns">{exec.namespace}</div>
                    </td>
                    <td><StatusBadge status={exec.status} /></td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: exec.workerName ? 'var(--text-2)' : 'var(--text-3)' }}>
                        {exec.workerName || 'server'}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'var(--font-mono)', fontSize: 11, color: exec.branch ? 'var(--accent)' : 'var(--text-3)' }}>
                        {exec.branch ? <><GitBranch size={11} />{exec.branch}</> : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="tc-trigger">{exec.triggeredBy}</span>
                    </td>
                    <td>
                      {exec.triggeredUser
                        ? <span className={looksLikeIp(exec.triggeredUser) ? 'tc-by-ip' : 'tc-by-user'}>{exec.triggeredUser}</span>
                        : <span className="tc-dash">—</span>}
                    </td>
                    <td>
                      <span className="tc-reltime">{formatRelative(exec.startTime)}</span>
                    </td>
                    <td>
                      <span className="tc-duration">{formatDuration(exec.duration)}</span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="tc-row-actions">
                        <button
                          className="tc-icon-btn"
                          onClick={() => navigate(`/flows/${exec.flowId}?tab=executions&exec=${exec.id}`)}
                          title="View execution"
                        >
                          <Eye size={14} />
                        </button>
                        {exec.status === 'RUNNING' && canEdit && (
                          <button
                            className="tc-icon-btn danger"
                            onClick={() => killExecution(exec.id)}
                            title="Kill execution"
                          >
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Kill</span>
                          </button>
                        )}
                        {exec.status !== 'RUNNING' && canEdit && canRunExec(exec) && (
                          <button
                            className="tc-icon-btn"
                            onClick={() => handleRerun(exec)}
                            disabled={rerunningId === exec.id}
                            title="Re-run (same worker & branch)"
                          >
                            {rerunningId === exec.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                          </button>
                        )}
                        {canDeleteExec(exec) && (
                          <button
                            className="tc-icon-btn danger"
                            onClick={() => handleDelete(exec.id)}
                            title="Delete execution"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
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
  );
};

export default ExecutionsList;
