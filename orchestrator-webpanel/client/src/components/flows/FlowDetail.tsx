import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import 'reactflow/dist/style.css';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  GanttChartSquare,
  GitBranch,
  GripHorizontal,
  GripVertical,
  Loader2,
  Paperclip,
  Play,
  RefreshCw,
  StopCircle,
  Trash2,
  X,
} from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useServerWorkers } from '../../hooks/useServerWorkers';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useSessionStore } from '../../store/sessionStore';
import StatusBadge from './StatusBadge';
import ScheduleModal from './ScheduleModal';
import FlowEditor from '../FlowEditor';
import SessionTabs from '../SessionTabs';
import { EditorLayout } from '../editor/EditorLayout';
import ExecutionGraph from '../execution/ExecutionGraph';
import ExecutionNodeTree from '../execution/ExecutionNodeTree';
import ExecutionTimeline from '../execution/ExecutionTimeline';
import { lastNodeDurations } from '../../utils/execTiming';
import { ansiToHtml } from '../../utils/ansiToHtml';
import type { OrchestratorFlow } from '../../store/flowLibraryStore';
import { useAuth } from '../../hooks/useAuth';

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

const LOG_TYPE_DEFS = [
  { key: 'input',  label: 'INPUT',  color: '#60a5fa' },
  { key: 'log',    label: 'LOG',    color: '#6b7280' },
  { key: 'output', label: 'OUTPUT', color: '#4ade80' },
  { key: 'error',  label: 'ERROR',  color: 'var(--err)' },
  { key: 'flow',   label: 'FLOW',   color: '#f59e0b' },
] as const;

function logTypeColor(type: string): string {
  switch (type) {
    case 'input':  return '#60a5fa';
    case 'output': return '#4ade80';
    case 'error':  return 'var(--err)';
    case 'flow':   return '#f59e0b';
    default:       return '#6b7280';
  }
}

function getNodeDepth(nodeId: string | null | undefined, parentMap: Map<string, string>): number {
  if (!nodeId) return 0;
  let d = 0, cur = nodeId;
  const seen = new Set<string>();
  while (parentMap.has(cur) && !seen.has(cur)) { seen.add(cur); d++; cur = parentMap.get(cur)!; }
  return d;
}


const ResizeHandleV: React.FC<{ width: number; setWidth: (w: number) => void }> = ({ width, setWidth }) => {
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      setWidth(Math.min(Math.max(drag.current.w + (e.clientX - drag.current.x), 120), 480));
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [setWidth]);
  return (
    <div
      onMouseDown={e => {
        drag.current = { x: e.clientX, w: width };
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
      }}
      title="Drag to resize"
      className="flex items-center justify-center flex-shrink-0"
      style={{ width: 9, cursor: 'ew-resize', background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      <GripVertical size={12} style={{ color: 'var(--text-mute)' }} />
    </div>
  );
};

const ResizeHandle: React.FC<{ height: number; setHeight: (h: number) => void; title?: string }> = ({ height, setHeight, title }) => {
  const drag = useRef<{ y: number; h: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      setHeight(Math.min(Math.max(drag.current.h + (e.clientY - drag.current.y), 120), 700));
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [setHeight]);
  return (
    <div
      onMouseDown={e => {
        drag.current = { y: e.clientY, h: height };
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
      }}
      title={title ?? 'Drag to resize'}
      className="flex items-center justify-center flex-shrink-0"
      style={{ height: 9, cursor: 'ns-resize', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
    >
      <GripHorizontal size={12} style={{ color: 'var(--text-mute)' }} />
    </div>
  );
};

const ExecutionsTab: React.FC<{ flow: OrchestratorFlow; highlightId?: string; onSelectExec: (id: string) => void }> = ({
  flow,
  highlightId,
  onSelectExec,
}) => {
  const flowId = flow.id;
  const { executions, killExecution, clearExecutions, renameExecution, syncBackendExecutions, flows } = useFlowLibraryStore();
  const { canEdit } = useAuth();
  const flowExecs = executions.filter(e => e.flowId === flowId);
  const [showGraph, setShowGraph] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);
  const [graphHeight, setGraphHeight] = useState(280);
  const [timelineHeight, setTimelineHeight] = useState(240);
  const [nodeTreeWidth, setNodeTreeWidth] = useState(220);
  const [selectedId, setSelectedId] = useState<string | null>(highlightId || flowExecs[0]?.id || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Selected node id from the structure tree — when set, log pane filters
  // to entries with `nodeId === selectedNodeId`. Toggle off by clicking the
  // same node again or hitting "clear".
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Live per-node execution status (fed by the SSE stream inside ExecutionGraph)
  // so the node tree shows the same running/retrying/success/error colour code.
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, any>>({});
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [collapsedFlowNodes, setCollapsedFlowNodes] = useState<Set<string>>(new Set());
  const [clearConfirm, setClearConfirm] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightId) setSelectedId(highlightId);
  }, [highlightId]);

  // Switching executions clears the node filter and collapse state so we don't
  // carry stale selections from a different flow snapshot.
  useEffect(() => {
    setSelectedNodeId(null);
    setCollapsedFlowNodes(new Set());
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

  // Hoist exec nodes/edges so memos below can depend on them.
  const execNodes = useMemo(
    () => (selectedExec?.nodes?.length ? selectedExec.nodes : flow.nodes) ?? [],
    [selectedExec, flow.nodes],
  );
  const execEdges = useMemo(
    () => (selectedExec?.edges?.length ? selectedExec.edges : flow.edges) ?? [],
    [selectedExec, flow.edges],
  );

  // Per-node duration (ms) of the LATEST run — fed to the execution graph badge.
  // (The timeline panel derives its own per-run segments from the log stream.)
  const nodeDurations = useMemo(
    () => (selectedExec ? lastNodeDurations(selectedExec.logs) : {}),
    [selectedExec?.id, selectedExec?.logs],
  );

  // Resolve a flow node's inner nodes — embedded JSON `code` first, then a
  // `flowRef` lookup in the library so a flownode pointing at another flow
  // still contributes its children to the parent/name maps.
  const resolveInnerNodes = (n: any): any[] => {
    if (n?.data?.code) {
      try {
        const inner = JSON.parse(n.data.code);
        if (Array.isArray(inner?.nodes)) return inner.nodes;
      } catch { /* fall through */ }
    }
    if (n?.data?.flowRef) {
      const linked = flows.find(f => f.id === n.data.flowRef);
      if (linked) return linked.nodes || [];
    }
    return [];
  };

  // Map child-node-id → parent-flow-node-id (for depth + collapse filtering).
  const parentMap = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: any[], parentId: string | null) => {
      for (const n of nodes) {
        if (parentId) map.set(n.id, parentId);
        if (n?.data?.type === 'flow') {
          const inner = resolveInnerNodes(n);
          if (inner.length) walk(inner, n.id);
        }
      }
    };
    walk(execNodes, null);
    return map;
  }, [execNodes, flows]);

  // Map node-id → human label (including inner nodes of flow nodes).
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        map.set(n.id, n.data?.label || n.id);
        if (n?.data?.type === 'flow') {
          const inner = resolveInnerNodes(n);
          if (inner.length) walk(inner);
        }
      }
    };
    walk(execNodes);
    return map;
  }, [execNodes, flows]);

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
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = selectedExec.logs.map(log => {
      const ts   = formatLogTimestamp(log.timestamp);
      const name = log.nodeId ? (nodeNameMap.get(log.nodeId) ?? log.nodeId) : '';
      const type = log.type === 'input' ? 'INPUT' : log.type === 'output' ? 'OUTPUT' : log.type === 'error' ? 'ERROR' : log.type === 'flow' ? 'FLOW' : 'LOG';
      const depth = getNodeDepth(log.nodeId, parentMap);
      const indent = '  '.repeat(depth);
      const msg  = stripAnsi(log.message || '');
      return `${indent}${ts}  ${name.padEnd(24)}  ${type.padEnd(6)}  ${msg}`;
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
            {canEdit && (
              <button
                onClick={() => {
                  if (!clearConfirm) {
                    setClearConfirm(true);
                    setTimeout(() => setClearConfirm(false), 3000);
                  } else {
                    clearExecutions(flowId);
                    setSelectedId(null);
                    setClearConfirm(false);
                  }
                }}
                className={`tc-btn${clearConfirm ? ' danger' : ''}`}
                style={{ flex: 1, justifyContent: 'center', height: 30, fontSize: 11 }}
                title={clearConfirm ? 'Click again to confirm' : 'Clear execution history'}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {clearConfirm ? 'Confirm clear?' : 'Clear history'}
              </button>
            )}
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
              {exec.status === 'RUNNING' && canEdit && (
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
              <span>·</span>
              <span>{formatDuration(exec.duration)}</span>
              <span>·</span>
              <span>{exec.triggeredBy}{exec.triggeredUser ? ` · ${exec.triggeredUser}` : ''}</span>
              <span>·</span>
              <span style={{ color: exec.workerName ? 'var(--text-2)' : 'var(--text-3)' }}>
                {exec.workerName || 'server'}
              </span>
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
                onClick={() => setShowTimeline(t => !t)}
                className={`tc-icon-btn${showTimeline ? ' active' : ''}`}
                title={showTimeline ? 'Hide timeline' : 'Show execution timeline (Gantt)'}
              >
                <GanttChartSquare size={14} />
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
              const hasNodes = execNodes.length > 0;
              // When the selection is a flow node, also surface logs from every
              // descendant in its subgraph — walk the child→parent map upward
              // and accept the log if `selectedNodeId` shows up anywhere in
              // the chain.
              const matchSelected = (logNodeId: string | null | undefined): boolean => {
                if (!selectedNodeId) return true;
                if (!logNodeId) return false;
                if (logNodeId === selectedNodeId) return true;
                let cur: string | undefined = logNodeId;
                const seen = new Set<string>();
                while (cur && parentMap.has(cur) && !seen.has(cur)) {
                  seen.add(cur);
                  const p = parentMap.get(cur)!;
                  if (p === selectedNodeId) return true;
                  cur = p;
                }
                return false;
              };
              const nodeFilteredLogs = selectedNodeId
                ? selectedExec.logs.filter(l => matchSelected(l.nodeId))
                : selectedExec.logs;
              const typedLogs = hiddenTypes.size > 0
                ? nodeFilteredLogs.filter(l => !hiddenTypes.has(l.type))
                : nodeFilteredLogs;
              // Hide entries whose ancestor flow-node is collapsed.
              const visibleLogs = collapsedFlowNodes.size > 0
                ? typedLogs.filter(l => {
                    if (!l.nodeId) return true;
                    let cur = l.nodeId;
                    const seen = new Set<string>();
                    while (parentMap.has(cur) && !seen.has(cur)) {
                      seen.add(cur);
                      const parent = parentMap.get(cur)!;
                      if (collapsedFlowNodes.has(parent)) return false;
                      cur = parent;
                    }
                    return true;
                  })
                : typedLogs;
              const toggleType = (k: string) => setHiddenTypes(prev => {
                const next = new Set(prev);
                if (next.has(k)) next.delete(k); else next.add(k);
                return next;
              });
              return (
                <>
                  {showGraph && hasNodes && (
                    <div className="flex-shrink-0">
                      <div style={{ height: graphHeight, background: 'var(--bg-2)' }}>
                        <ExecutionGraph
                          executionId={selectedExec.id}
                          flowDefinition={{ nodes: execNodes, edges: execEdges }}
                          selectedNodeId={selectedNodeId}
                          onNodeSelect={id => setSelectedNodeId(id)}
                          onStatusesChange={setNodeStatuses}
                          nodeDurations={nodeDurations}
                        />
                      </div>
                      <ResizeHandle height={graphHeight} setHeight={setGraphHeight} title="Drag to resize the flow graph" />
                    </div>
                  )}
                  {showTimeline && hasNodes && (
                    <div className="flex-shrink-0">
                      <div style={{ height: timelineHeight }}>
                        <ExecutionTimeline
                          exec={selectedExec}
                          nodes={execNodes}
                          edges={execEdges}
                          parentMap={parentMap}
                          nodeNameMap={nodeNameMap}
                          statuses={nodeStatuses}
                          selectedNodeId={selectedNodeId}
                          onSelect={id => setSelectedNodeId(id)}
                        />
                      </div>
                      <ResizeHandle height={timelineHeight} setHeight={setTimelineHeight} title="Drag to resize the timeline" />
                    </div>
                  )}
                  <div className="flex-1 flex overflow-hidden">
                    {hasNodes && (
                      <>
                        <div style={{ width: nodeTreeWidth, flexShrink: 0, overflow: 'hidden' }}>
                          <ExecutionNodeTree
                            nodes={execNodes}
                            edges={execEdges}
                            selectedId={selectedNodeId}
                            onSelect={setSelectedNodeId}
                            statuses={nodeStatuses}
                          />
                        </div>
                        <ResizeHandleV width={nodeTreeWidth} setWidth={setNodeTreeWidth} />
                      </>
                    )}
                    <div
                      ref={logRef}
                      className="flex-1 overflow-auto p-3"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6, color: 'var(--text)' }}
                    >
                      {/* Filter bar */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap" style={{ fontSize: 11, minHeight: 22 }}>
                        {selectedNodeId ? (
                          <>
                            <span style={{ color: 'var(--text-3)' }}>Node:</span>
                            <code style={{ color: 'var(--accent)' }}>{nodeNameMap.get(selectedNodeId) ?? selectedNodeId}</code>
                            <button
                              onClick={() => setSelectedNodeId(null)}
                              style={{ color: 'var(--text-3)', background: 'none', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 10, padding: '0px 5px', borderRadius: 3 }}
                            >clear</button>
                          </>
                        ) : (
                          <span style={{ color: 'var(--text-mute)', fontSize: 10, fontStyle: 'italic' }}>all nodes</span>
                        )}
                        <span style={{ marginLeft: 'auto', color: 'var(--text-mute)', fontSize: 10 }}>
                          {visibleLogs.length}/{selectedExec.logs.length}
                        </span>
                        <div className="flex items-center gap-1">
                          {LOG_TYPE_DEFS.map(t => (
                            <button
                              key={t.key}
                              onClick={() => toggleType(t.key)}
                              style={{
                                padding: '1px 6px',
                                borderRadius: 3,
                                border: `1px solid ${hiddenTypes.has(t.key) ? 'var(--border)' : t.color}`,
                                background: hiddenTypes.has(t.key) ? 'transparent' : 'var(--bg-3)',
                                color: hiddenTypes.has(t.key) ? 'var(--text-mute)' : t.color,
                                fontSize: 10,
                                fontFamily: 'var(--font-mono)',
                                cursor: 'pointer',
                                letterSpacing: '0.04em',
                              }}
                            >{t.label}</button>
                          ))}
                        </div>
                      </div>
                      {/* Log rows */}
                      {visibleLogs.length === 0 ? (
                        <p style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>
                          {selectedExec.logs.length === 0 ? 'No logs yet...' : 'No logs match the current filters'}
                        </p>
                      ) : (
                        <div className="space-y-0.5">
                          {visibleLogs.map((log, i) => {
                            const prev = i > 0 ? visibleLogs[i - 1] : null;
                            const repeatMeta = !!prev &&
                              formatLogTimestamp(prev.timestamp) === formatLogTimestamp(log.timestamp) &&
                              prev.nodeId === log.nodeId;
                            const typeColor = logTypeColor(log.type);
                            const nodeName = log.nodeId ? (nodeNameMap.get(log.nodeId) ?? log.nodeId) : null;
                            const depth = getNodeDepth(log.nodeId, parentMap);
                            const isFlowMarker = log.type === 'flow' && typeof log.message === 'string' && log.message.startsWith('[flow] ');
                            const isCollapsed = isFlowMarker && !!log.nodeId && collapsedFlowNodes.has(log.nodeId);
                            return (
                              <div
                                key={i}
                                className="grid gap-x-4 leading-5"
                                style={{
                                  gridTemplateColumns: '148px 108px 52px minmax(0,1fr)',
                                  alignItems: 'baseline',
                                  paddingLeft: depth * 14,
                                }}
                              >
                                <span
                                  className="select-none whitespace-nowrap"
                                  style={{ color: 'var(--text-mute)', fontSize: 10.5, visibility: repeatMeta ? 'hidden' : 'visible' }}
                                >
                                  {formatLogTimestamp(log.timestamp)}
                                </span>
                                <span
                                  className="select-none truncate"
                                  style={{ color: 'var(--text-3)', fontSize: 10.5, visibility: repeatMeta ? 'hidden' : 'visible' }}
                                  title={nodeName ?? ''}
                                >
                                  {nodeName ?? ''}
                                </span>
                                <span
                                  className="select-none uppercase font-medium"
                                  style={{ color: typeColor, fontSize: 10, letterSpacing: '0.06em' }}
                                >
                                  {log.type === 'input' ? 'INPUT' : log.type === 'output' ? 'OUTPUT' : log.type === 'error' ? 'ERROR' : log.type === 'flow' ? 'FLOW' : 'LOG'}
                                </span>
                                {isFlowMarker && log.nodeId ? (
                                  <div
                                    className="flex items-center gap-1 min-w-0 cursor-pointer select-none"
                                    style={{ color: typeColor }}
                                    onClick={() => setCollapsedFlowNodes(prev => {
                                      const next = new Set(prev);
                                      if (next.has(log.nodeId!)) next.delete(log.nodeId!); else next.add(log.nodeId!);
                                      return next;
                                    })}
                                  >
                                    {isCollapsed
                                      ? <ChevronRight size={11} style={{ flexShrink: 0 }} />
                                      : <ChevronDown size={11} style={{ flexShrink: 0 }} />
                                    }
                                    <span className="min-w-0 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: ansiToHtml(log.message) }} />
                                  </div>
                                ) : (
                                  <span
                                    className="min-w-0 whitespace-pre-wrap break-words"
                                    style={{ color: typeColor }}
                                    dangerouslySetInnerHTML={{ __html: ansiToHtml(log.message) }}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
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
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const artifacts = flow.artifacts || [];

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
      // Don't persist transient run overlays (live status / attempt counters).
      const cleanNodes = nodes.map(n => ({ ...n, data: { ...n.data, executionStatus: undefined, executionAttempt: undefined } }));
      updateFlow(flow.id, { nodes: cleanNodes, edges });
      setSaveState('saved');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState('idle'), 2000);
    }, 800);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [nodes, edges, isFlowSession]);

  const handleArtifactUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    Promise.all(files.map(file => new Promise<{name: string; data: string}>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve({ name: file.name, data: (ev.target?.result as string).split(',')[1] });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }))).then(newArtifacts => {
      const merged = [...artifacts];
      for (const a of newArtifacts) {
        const idx = merged.findIndex(x => x.name === a.name);
        if (idx >= 0) merged[idx] = a; else merged.push(a);
      }
      updateFlow(flow.id, { artifacts: merged });
    });
    e.target.value = '';
  };

  const handleArtifactRemove = (name: string) => {
    updateFlow(flow.id, { artifacts: artifacts.filter(a => a.name !== name) });
  };

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
          <button
            onClick={() => setShowArtifacts(v => !v)}
            className={`tc-btn ghost`}
            style={{ height: 24, padding: '0 8px', gap: 4, fontSize: 11, color: artifacts.length ? 'var(--accent)' : undefined }}
            title="Manage flow artifacts"
          >
            <Paperclip size={11} />
            Artifacts{artifacts.length > 0 ? ` (${artifacts.length})` : ''}
          </button>
        </div>
      </div>

      {showArtifacts && (
        <div className="flex-shrink-0 px-3 py-2 border-b" style={{ background: 'var(--bg-2)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Artifacts</span>
            <span style={{ fontSize: 10, color: 'var(--text-mute)' }}>— files extracted to ORCHESTRATOR_EXECUTION_DIR before each execution</span>
            <label className="tc-btn ghost" style={{ height: 22, padding: '0 8px', fontSize: 11, cursor: 'pointer', marginLeft: 'auto' }}>
              + Add files
              <input type="file" multiple style={{ display: 'none' }} onChange={handleArtifactUpload} />
            </label>
          </div>
          {artifacts.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-mute)', fontStyle: 'italic' }}>No artifacts. Add files to deploy alongside this flow.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {artifacts.map(a => (
                <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                  <Paperclip size={10} style={{ color: 'var(--text-3)' }} />
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{a.name}</span>
                  <button onClick={() => handleArtifactRemove(a.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0, marginLeft: 2 }}>
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <EditorLayout
          graphPanel={
            <FlowEditor
              embedded
              flowId={flow.id}
              versionsVisible={showVersions}
              onToggleVersions={() => setShowVersions(v => !v)}
            />
          }
          flowId={flow.id}
          showVersions={showVersions}
          onToggleVersions={() => setShowVersions(v => !v)}
        />
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
  const { canEdit, isViewer, isAdmin, canManageSchedules } = useAuth();

  const rawTabParam = searchParams.get('tab');
  const tabParam: TabId = !isViewer && rawTabParam === 'edit' ? 'edit' : 'executions';
  // Schedule tab was removed — fall through to edit if a deep link still uses it.
  const highlightExec = searchParams.get('exec') || undefined;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam);
  const [showSchedule, setShowSchedule] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [renamingNs, setRenamingNs] = useState(false);
  const [nsValue, setNsValue] = useState('');

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
    ...(!isViewer ? [{ id: 'edit' as TabId, label: 'Edit', icon: Edit3 }] : []),
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
          {renamingNs ? (
            <input
              autoFocus
              value={nsValue}
              onChange={e => setNsValue(e.target.value)}
              onBlur={() => {
                const t = nsValue.trim();
                if (t && t !== (flow.namespace || 'default')) updateFlow(flow.id, { namespace: t });
                setRenamingNs(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') { const t = nsValue.trim(); if (t && t !== (flow.namespace || 'default')) updateFlow(flow.id, { namespace: t }); setRenamingNs(false); }
                if (e.key === 'Escape') setRenamingNs(false);
              }}
              style={{ background: 'var(--bg-3)', border: '1px solid var(--accent)', borderRadius: 3, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '1px 5px', width: 140 }}
            />
          ) : (
            <span
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)', fontSize: 12, cursor: canEdit ? 'text' : 'default' }}
              onDoubleClick={canEdit ? () => { setNsValue(flow.namespace || 'default'); setRenamingNs(true); } : undefined}
              title={canEdit ? 'Double-click to rename namespace' : undefined}
            >
              {flow.namespace}
            </span>
          )}
          <span style={{ color: 'var(--text-mute)', fontFamily: 'var(--font-mono)' }}>/</span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {renamingName ? (
                <input
                  autoFocus
                  value={nameValue}
                  onChange={e => setNameValue(e.target.value)}
                  onBlur={() => {
                    const t = nameValue.trim();
                    if (t && t !== flow.name) updateFlow(flow.id, { name: t });
                    setRenamingName(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { const t = nameValue.trim(); if (t && t !== flow.name) updateFlow(flow.id, { name: t }); setRenamingName(false); }
                    if (e.key === 'Escape') setRenamingName(false);
                  }}
                  style={{ background: 'var(--bg-3)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 15, padding: '1px 6px', minWidth: 120 }}
                />
              ) : (
                <h1
                  style={{ margin: 0, fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 15, color: 'var(--text)', cursor: canEdit ? 'text' : 'default' }}
                  onDoubleClick={canEdit ? () => { setNameValue(flow.name); setRenamingName(true); } : undefined}
                  title={canEdit ? 'Double-click to rename' : undefined}
                >
                  {flow.name}
                </h1>
              )}
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
            {canManageSchedules && (
              <button
                onClick={() => setShowSchedule(true)}
                className="tc-btn ghost"
                title={flow.schedule ? flow.schedule.cron : 'Schedule'}
                style={{ height: 28, width: 28, padding: 0, justifyContent: 'center' }}
              >
                <Clock size={14} />
              </button>
            )}
            <button
              onClick={() => {
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
                const data = { name: flow.name, namespace: flow.namespace, description: flow.description, nodes: resolvedNodes, edges: flow.edges || [], artifacts: flow.artifacts || [] };
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${flow.name.replace(/\s+/g, '-')}.or`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="tc-btn ghost"
              title="Export .or file"
              style={{ height: 28, width: 28, padding: 0, justifyContent: 'center' }}
            >
              <Download size={14} />
            </button>
            {canEdit && (
              <button
                onClick={handleDelete}
                className={`tc-btn${deleteConfirm ? ' danger' : ' ghost'}`}
                style={{ height: 28, width: 28, padding: 0, justifyContent: 'center' }}
              >
                {deleteConfirm ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
              </button>
            )}
            {canEdit && (() => {
              const grouped = serverWorkers.reduce((acc, w) => {
                const g = w.group || '';
                (acc[g] = acc[g] || []).push(w);
                return acc;
              }, {} as Record<string, typeof serverWorkers>);
              const ungrouped = grouped[''] || [];
              const namedGroups = Object.keys(grouped).filter(k => k !== '').sort();
              return (
                <select
                  value={flow.workerId || ''}
                  onChange={(e) => updateFlow(flow.id, { workerId: e.target.value })}
                  title="Run this flow on"
                  style={{
                    height: 28, padding: '0 8px', borderRadius: 6,
                    background: 'var(--bg-2)', color: 'var(--text)',
                    border: '1px solid var(--border)', fontSize: 12,
                    fontFamily: 'var(--font-mono)', cursor: 'pointer', maxWidth: 180,
                  }}
                >
                  <option value="">Local (server)</option>
                  {ungrouped.map(w => (
                    <option key={w._id} value={w._id}>
                      {w.name}{w.status !== 'online' ? ' · offline' : ''}
                    </option>
                  ))}
                  {namedGroups.map(g => (
                    <optgroup key={g} label={g}>
                      {(grouped[g] || []).map(w => (
                        <option key={w._id} value={w._id}>
                          {w.name}{w.status !== 'online' ? ' · offline' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              );
            })()}
            {canEdit && (
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
            )}
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
