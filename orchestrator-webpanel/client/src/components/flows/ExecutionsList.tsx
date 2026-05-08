import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Trash2 } from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import StatusBadge from './StatusBadge';
import ExecIdCell from './ExecIdCell';
import type { ExecutionStatus } from '../../types/flows';

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
  const { executions, killExecution, clearExecutions, syncBackendExecutions } = useFlowLibraryStore();

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
          <button
            className="tc-btn danger"
            onClick={() => clearExecutions()}
            disabled={executions.length === 0}
          >
            <Trash2 size={13} />Clear history
          </button>
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

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="tc-card">
          <div className="tc-empty">
            {search || statusFilter !== 'ALL' ? 'no executions match the current filter' : 'no executions yet'}
          </div>
        </div>
      ) : (
        <div className="tc-card">
          <table className="tc-table">
            <thead>
              <tr>
                <th>Execution</th>
                <th>Flow</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Started</th>
                <th>Duration</th>
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
                      <span className="tc-trigger">{exec.triggeredBy}</span>
                    </td>
                    <td>
                      <span className="tc-reltime">{formatRelative(exec.startTime)}</span>
                    </td>
                    <td>
                      <span className="tc-duration">{formatDuration(exec.duration)}</span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="tc-row-actions">
                        {exec.status === 'RUNNING' && (
                          <button
                            className="tc-icon-btn danger"
                            onClick={() => killExecution(exec.id)}
                            title="Kill execution"
                          >
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Kill</span>
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
