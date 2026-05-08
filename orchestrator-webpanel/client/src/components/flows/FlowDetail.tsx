import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import 'reactflow/dist/style.css';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  StopCircle,
  Trash2,
} from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useServerWorkers } from '../../hooks/useServerWorkers';
import { useTheme } from '../../context/ThemeContext';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useSessionStore } from '../../store/sessionStore';
import StatusBadge from './StatusBadge';
import ScheduleModal from './ScheduleModal';
import FlowEditor from '../FlowEditor';
import SessionTabs from '../SessionTabs';
import { EditorLayout } from '../editor/EditorLayout';
import ExecutionGraph from '../execution/ExecutionGraph';
import ExecutionNodeTree from '../execution/ExecutionNodeTree';
import { ansiToHtml } from '../../utils/ansiToHtml';
import type { OrchestratorFlow } from '../../store/flowLibraryStore';

type TabId = 'executions' | 'edit';

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-';
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

function formatLogTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (value: number, size = 2) => value.toString().padStart(size, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const ExecutionsTab: React.FC<{ flow: OrchestratorFlow; highlightId?: string; onSelectExec: (id: string) => void }> = ({
  flow,
  highlightId,
  onSelectExec,
}) => {
  const flowId = flow.id;
  const { executions, killExecution, clearExecutions, renameExecution, syncBackendExecutions } = useFlowLibraryStore();
  const flowExecs = executions.filter(e => e.flowId === flowId);
  const [showGraph, setShowGraph] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(highlightId || flowExecs[0]?.id || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Selected node id from the structure tree — when set, log pane filters
  // to entries with `nodeId === selectedNodeId`. Toggle off by clicking the
  // same node again or hitting "clear".
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightId) setSelectedId(highlightId);
  }, [highlightId]);

  // Switching executions clears the node filter so we don't carry a stale
  // selection from a different flow snapshot.
  useEffect(() => {
    setSelectedNodeId(null);
  }, [selectedId]);

  // Live-tail executions while the user is on this tab. This catches executions
  // started by cron / API triggers (anything not initiated from this browser),
  // surfaces them in the list, and pumps logs/status updates without a refresh
  // click. Cheap: one GET /api/v1/executions every 3s + the per-exec poller
  // already handles RUNNING ones once discovered.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try { await syncBackendExecutions(flowId); } catch { /* network blip is fine */ }
    };
    // First tick immediately so we don't wait 3s on tab open.
    tick();
    const interval = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [flowId, syncBackendExecutions]);

  const selectedExec = flowExecs.find(e => e.id === selectedId);
  const selectedLabel = selectedExec ? (selectedExec.displayName || selectedExec.id) : '';

  // If nothing is selected yet (or the selected one disappeared), pick the
  // newest exec so a freshly-discovered cron/API run lands as the default
  // selection and the user sees it instantly.
  useEffect(() => {
    if (!selectedId && flowExecs.length > 0) setSelectedId(flowExecs[0].id);
  }, [flowExecs.length, selectedId]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [selectedExec?.logs.length, selectedExec?.id]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    onSelectExec(id);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await syncBackendExecutions(flowId);
    } finally {
      setIsRefreshing(false);
    }
  };

  const exportSelectedLogs = () => {
    if (!selectedExec) return;
    const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = selectedExec.logs.map(log => {
      const time = new Date(log.timestamp).toISOString();
      const node = log.nodeId ? ` [${log.nodeId}]` : '';
      return `[${time}] [${log.type.toUpperCase()}]${node} ${stripAnsi(log.message || '')}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedLabel.replace(/[^a-z0-9_-]/gi, '_')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (flowExecs.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3" style={{ color: 'var(--text-3)' }}>
        <Activity className="w-8 h-8" />
        <p className="text-sm">No executions yet — hit Execute to run this flow</p>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      <div className="w-80 flex-shrink-0 border-r overflow-auto" style={{ borderColor: 'var(--border)' }}>
        <div className="sticky top-0 z-10 px-3 py-2 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="tc-icon-btn"
              style={{ border: '1px solid var(--border)' }}
              title="Refresh executions"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => { clearExecutions(flowId); setSelectedId(null); }}
              className="tc-btn danger" style={{ flex: 1, justifyContent: 'center', height: 30, fontSize: 11 }}
            >
              <Trash2 className="w-3.5 h-3.5" />Clear history
            </button>
          </div>
        </div>
        {flowExecs.map(exec => (
          <div
            key={exec.id}
            onClick={() => handleSelect(exec.id)}
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
              background: exec.id === selectedId ? 'var(--accent-soft)' : 'transparent',
              transition: 'background 100ms',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <StatusBadge status={exec.status} size="sm" />
              {exec.status === 'RUNNING' && (
                <button
                  onClick={e => { e.stopPropagation(); killExecution(exec.id); }}
                  className="tc-btn danger" style={{ height: 22, padding: '0 8px', fontSize: 11 }}
                >
                  <StopCircle className="w-3 h-3" />Kill
                </button>
              )}
            </div>
            <p className="font-mono text-xs mt-1 truncate" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{exec.displayName || `${exec.id.slice(0, 16)}...`}</p>
            <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              <span>{formatRelative(exec.startTime)}</span>
              <span>-</span>
              <span>{formatDuration(exec.duration)}</span>
              <span>-</span>
              <span className="capitalize">{exec.triggeredBy}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
        {selectedExec ? (
          <>
            <div className="px-4 py-2 border-b flex items-center gap-3 flex-shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <StatusBadge status={selectedExec.status} />
              <input
                value={selectedLabel}
                onChange={e => renameExecution(selectedExec.id, e.target.value)}
                style={{
                  minWidth: 0, flex: 1, borderRadius: 6, border: '1px solid var(--border)',
                  padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 11,
                  outline: 'none', background: 'var(--surface-2)', color: 'var(--text)',
                }}
                title={`Execution id: ${selectedExec.id}`}
              />
              <button
                onClick={() => setShowGraph(g => !g)}
                className={`tc-icon-btn${showGraph ? ' active' : ''}`}
                title={showGraph ? 'Hide flow graph' : 'Show flow graph'}
              >
                <GitBranch size={14} />
              </button>
              <button
                onClick={exportSelectedLogs}
                className="tc-icon-btn"
                title="Export logs"
              >
                <Download size={14} />
              </button>
              {selectedExec.status === 'RUNNING' && (
                <span className="ml-auto flex items-center gap-1 text-xs" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  <Loader2 size={11} className="animate-spin" />Live
                </span>
              )}
            </div>

            {(() => {
              // Prefer the snapshot recorded at execution time so old runs
              // always render the graph + tree they actually executed against.
              const execNodes = selectedExec.nodes && selectedExec.nodes.length > 0 ? selectedExec.nodes : flow.nodes;
              const execEdges = selectedExec.edges && selectedExec.edges.length > 0 ? selectedExec.edges : flow.edges;
              const hasNodes = execNodes && execNodes.length > 0;
              const visibleLogs = selectedNodeId
                ? selectedExec.logs.filter(l => l.nodeId === selectedNodeId)
                : selectedExec.logs;
              return (
                <>
                  {showGraph && hasNodes && (
                    <div className="flex-shrink-0 border-b" style={{ height: 280, borderColor: 'var(--border)', background: 'var(--bg-2)' }}>
                      <ExecutionGraph
                        executionId={selectedExec.id}
                        flowDefinition={{ nodes: execNodes, edges: execEdges }}
                      />
                    </div>
                  )}
                  <div className="flex-1 flex overflow-hidden">
                    {hasNodes && (
                      <div style={{ width: 220, flexShrink: 0 }}>
                        <ExecutionNodeTree
                          nodes={execNodes}
                          edges={execEdges}
                          selectedId={selectedNodeId}
                          onSelect={setSelectedNodeId}
                        />
                      </div>
                    )}
                    <div
                      ref={logRef}
                      className="flex-1 overflow-auto p-3 space-y-0.5"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6, color: 'var(--text)' }}
                    >
                      {selectedNodeId && (
                        <div className="flex items-center gap-2 mb-2 px-2 py-1 rounded" style={{ background: 'var(--bg-3)', color: 'var(--text-3)', fontSize: 11 }}>
                          <span>Filtered to node <code style={{ color: 'var(--accent)' }}>{selectedNodeId}</code> ({visibleLogs.length} of {selectedExec.logs.length})</span>
                          <button onClick={() => setSelectedNodeId(null)} className="ml-auto" style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11 }}>clear</button>
                        </div>
                      )}
                      {visibleLogs.length === 0 ? (
                        <p style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>
                          {selectedExec.logs.length === 0 ? 'No logs yet...' : 'No logs for this node yet'}
                        </p>
                      ) : (
                        visibleLogs.map((log, i) => (
                          <div key={i} className="grid grid-cols-[154px_54px_minmax(0,1fr)] gap-3 leading-5">
                            <span className="select-none whitespace-nowrap" style={{ color: 'var(--text-mute)' }}>
                              {formatLogTimestamp(log.timestamp)}
                            </span>
                            <span className="select-none uppercase" style={{
                              color: log.type === 'error' ? 'var(--err)' : log.type === 'output' ? 'var(--accent)' : 'var(--text-3)',
                            }}>
                              {log.type}
                            </span>
                            <span className="min-w-0 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: ansiToHtml(log.message) }} />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            Select an execution to view logs
          </div>
        )}
      </div>
    </div>
  );
};

const EditorTab: React.FC<{ flow: OrchestratorFlow }> = ({ flow }) => {
  const { nodes, edges } = useFlowStore();
  const { sessions, activeSessionId, createSession, switchSession, updateActiveFlowState } = useSessionStore();
  const { updateFlow } = useFlowLibraryStore();

  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const isFlowSession = activeSession?.linkedFlowId === flow.id;

  useEffect(() => {
    if (initializedRef.current === flow.id) return;
    initializedRef.current = flow.id;
    hydratedRef.current = false;

    const flowSessions = sessions.filter(s => s.linkedFlowId === flow.id);
    if (flowSessions.length === 0) {
      createSession(flow.name, flow.id).then(() => {
        updateActiveFlowState({ nodes: flow.nodes || [], edges: flow.edges || [], history: [], historyIndex: -1 });
        hydratedRef.current = true;
      });
    } else {
      if (!flowSessions.some(s => s.id === activeSessionId)) {
        switchSession(flowSessions[0].id);
      }
      setTimeout(() => {
        updateActiveFlowState({ nodes: flow.nodes || [], edges: flow.edges || [], history: [], historyIndex: -1 });
        hydratedRef.current = true;
      }, 0);
    }
  }, [flow.id]);

  useEffect(() => {
    if (!isFlowSession || !hydratedRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      updateFlow(flow.id, { nodes, edges });
      setSaveState('saved');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState('idle'), 2000);
    }, 800);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [nodes, edges, isFlowSession]);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <SessionTabs flowId={flow.id} compact />
        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          {saveState === 'saved' && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--ok)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <CheckCircle2 size={12} />Saved
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <EditorLayout graphPanel={<FlowEditor embedded flowId={flow.id} />} />
      </div>
    </div>
  );
};

const FlowDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { flows, deleteFlow, executeFlow, updateFlow } = useFlowLibraryStore();
  const { workers: serverWorkers } = useServerWorkers();

  const rawTabParam = searchParams.get('tab');
  const tabParam: TabId = rawTabParam === 'executions' ? 'executions' : 'edit';
  // Schedule tab was removed — fall through to edit if a deep link still uses it.
  const highlightExec = searchParams.get('exec') || undefined;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam);
  const [showSchedule, setShowSchedule] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const flow = flows.find(f => f.id === id);
  const assignedWorker = flow?.workerId ? serverWorkers.find(w => w._id === flow.workerId) : undefined;

  useEffect(() => {
    setActiveTab(tabParam);
    if (!rawTabParam || rawTabParam === 'overview') {
      const p = new URLSearchParams(searchParams);
      p.set('tab', tabParam);
      setSearchParams(p, { replace: true });
    }
  }, [tabParam, rawTabParam]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    const p = new URLSearchParams(searchParams);
    p.set('tab', tab);
    setSearchParams(p, { replace: true });
  };

  const handleExecute = async () => {
    if (!id) return;
    setRunning(true);
    try {
      const execId = await executeFlow(id);
      const p = new URLSearchParams(searchParams);
      p.set('tab', 'executions');
      p.set('exec', execId);
      setSearchParams(p, { replace: true });
      setActiveTab('executions');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      setTimeout(() => setDeleteConfirm(false), 3000);
      return;
    }
    if (!id) return;
    deleteFlow(id);
    navigate('/flows');
  };

  const handleScheduleSave = (schedule: { cron: string; enabled: boolean; timezone: string } | null) => {
    if (!id) return;
    updateFlow(id, { schedule: schedule ?? undefined });
    setShowSchedule(false);
  };

  const handleExecSelect = (execId: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('exec', execId);
    setSearchParams(p, { replace: true });
  };

  if (!flow) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4" style={{ color: 'var(--text-3)' }}>
        <AlertCircle className="w-10 h-10" style={{ color: 'var(--err)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Flow not found</p>
        <button onClick={() => navigate('/flows')} style={{ color: 'var(--accent)', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }}>Back to Flows</button>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'executions', label: 'Executions', icon: Activity },
    { id: 'edit', label: 'Edit', icon: Edit3 },
  ];

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        <div className="px-5 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/flows')}
            className="tc-btn ghost"
            style={{ height: 28, padding: '0 10px', gap: 6 }}
          >
            <ArrowLeft size={14} />
            Flows
          </button>

          <span style={{ color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>/</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)', fontSize: 12 }}>{flow.namespace}</span>
          <span style={{ color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>/</span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 style={{ margin: 0, fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 15, color: 'var(--text)' }}>
                {flow.name}
              </h1>
              {flow.lastExecution && <StatusBadge status={flow.lastExecution.status} />}
            </div>
            {assignedWorker && (
              <div className="flex items-center gap-2 mt-0.5">
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: assignedWorker.status === 'online' ? 'var(--ok)' : 'var(--text-mute)',
                }} />
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  {assignedWorker.name}{assignedWorker.status !== 'online' ? ' · offline' : ''}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSchedule(true)}
              className="tc-btn ghost"
              style={{ fontSize: 11, height: 28, fontFamily: 'var(--font-mono)' }}
            >
              <Clock size={12} />
              {flow.schedule ? flow.schedule.cron : 'Schedule'}
            </button>
            <button
              onClick={handleDelete}
              className={`tc-btn${deleteConfirm ? ' danger' : ' ghost'}`}
              style={{ height: 28, width: 28, padding: 0, justifyContent: 'center' }}
            >
              {deleteConfirm ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
            </button>
            <button
              onClick={handleExecute}
              disabled={running}
              title="Execute flow"
              className="tc-btn primary"
              style={{ height: 28 }}
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {running ? 'Running…' : 'Execute'}
            </button>
          </div>
        </div>

        <div className="tc-flow-tabs" style={{ paddingLeft: 12 }}>
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`tc-flow-tab${activeTab === tab.id ? ' active' : ''}`}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'executions' && (
          <ExecutionsTab flow={flow} highlightId={highlightExec} onSelectExec={handleExecSelect} />
        )}
        {activeTab === 'edit' && <EditorTab flow={flow} />}
      </div>

      {showSchedule && (
        <ScheduleModal flow={flow} onClose={() => setShowSchedule(false)} onSave={handleScheduleSave} />
      )}
    </div>
  );
};

export default FlowDetail;
