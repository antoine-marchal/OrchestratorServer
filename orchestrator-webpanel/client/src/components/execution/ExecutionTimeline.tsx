import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import type { FlowExecution, ExecutionStatus } from '../../types/flows';
import { computeNodeRuns, formatDurationShort, type NodeRun } from '../../utils/execTiming';
import {
  NodeIcon, StatusIcon, RelationBadge, topologicalSort, buildRelations, isVisibleInTree,
  type NodeExecStatus,
} from './ExecutionNodeTree';

interface ExecutionTimelineProps {
  exec: FlowExecution;
  /** Flattened node list of the execution snapshot (top-level nodes; flow nodes carry inner nodes in data.code). */
  nodes: any[];
  /** Top-level edges of the execution snapshot. */
  edges: any[];
  /** child-node-id -> parent-flow-node-id */
  parentMap: Map<string, string>;
  /** node-id -> human label */
  nodeNameMap: Map<string, string>;
  /** live per-node status from the SSE stream (id -> 'running'|'success'|...) */
  statuses: Record<string, string>;
  selectedNodeId?: string | null;
  onSelect?: (id: string | null) => void;
}

const STATUS_COLOR: Record<string, string> = {
  success: 'var(--ok)',
  failed: 'var(--err)',
  killed: 'var(--err)',
  running: 'var(--accent)',
  retrying: 'var(--warn)',
  skipped: 'var(--text-3)',
  pending: 'var(--text-mute)',
  queued: 'var(--text-mute)',
};

function mapExecStatus(s: ExecutionStatus): string {
  switch (s) {
    case 'SUCCESS': return 'success';
    case 'FAILED': return 'failed';
    case 'KILLED': return 'killed';
    case 'RUNNING': return 'running';
    case 'QUEUED': return 'queued';
    default: return 'pending';
  }
}

/** Coerce the timeline's loose status string into the NodeExecStatus the shared StatusIcon understands. */
function toExecStatus(s: string): NodeExecStatus {
  switch (s) {
    case 'killed': return 'failed';
    case 'queued': return 'pending';
    case 'running': case 'success': case 'failed': case 'retrying': case 'skipped': case 'pending':
      return s;
    default: return 'pending';
  }
}

interface RunSeg extends NodeRun { status: string }
interface RelItem { id: string; label: string }
interface Row {
  id: string;
  label: string;
  depth: number;
  type?: string;
  runs: RunSeg[];
  rowStatus: string;
  preds: RelItem[];
  succs: RelItem[];
  isFlow: boolean;
  selectable: boolean;
  parentId?: string;
  hasChildren?: boolean;
}

function parseInner(node: any): { nodes: any[]; edges: any[] } {
  const code = node?.data?.code;
  if (!code || typeof code !== 'string') return { nodes: [], edges: [] };
  try {
    const p = JSON.parse(code);
    return { nodes: Array.isArray(p?.nodes) ? p.nodes : [], edges: Array.isArray(p?.edges) ? p.edges : [] };
  } catch { return { nodes: [], edges: [] }; }
}

const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({
  exec, nodes, edges, parentMap, nodeNameMap, statuses, selectedNodeId, onSelect,
}) => {
  void parentMap; // depth derived from the node tree walk below
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const { rows, flowStart, totalSpan } = useMemo(() => {
    const runsByNode = computeNodeRuns(exec.logs);
    const execDone = exec.status !== 'RUNNING' && exec.status !== 'QUEUED';

    const flowStart = new Date(exec.startTime).getTime();
    let flowEnd = exec.endTime ? new Date(exec.endTime).getTime() : 0;
    for (const list of runsByNode.values()) for (const r of list) flowEnd = Math.max(flowEnd, r.end);
    if (!exec.endTime) flowEnd = Math.max(flowEnd, Date.now());
    flowEnd = Math.max(flowEnd, flowStart + 1);
    const totalSpan = flowEnd - flowStart;

    const segsFor = (id: string): RunSeg[] => {
      const list = runsByNode.get(id) ?? [];
      return list.map((r, i) => {
        const isLast = i === list.length - 1;
        let status: string;
        if (r.hasError) status = 'failed';
        else if (isLast) status = statuses[id] ?? (execDone ? 'success' : 'running');
        else status = 'success';
        return { ...r, status };
      });
    };
    const rowStatusFor = (id: string, segs: RunSeg[]): string => {
      if (statuses[id]) return statuses[id];
      if (segs.length === 0) return 'pending';
      return segs[segs.length - 1].status;
    };

    const topRelations = buildRelations(nodes as any, edges as any);

    const rows: Row[] = [{
      id: '__flow__',
      label: exec.displayName || 'Flow',
      depth: 0,
      runs: [{ start: flowStart, end: flowEnd, hasError: exec.status === 'FAILED', status: mapExecStatus(exec.status) }],
      rowStatus: mapExecStatus(exec.status),
      preds: [], succs: [],
      isFlow: true,
      selectable: false,
    }];

    const pushNode = (n: any, depth: number, rel: Record<string, { preds: RelItem[]; succs: RelItem[] }>) => {
      const type = n?.data?.type;
      const id: string = n.id;
      const inner = type === 'flow' ? parseInner(n) : { nodes: [], edges: [] };
      const isFlow = inner.nodes.length > 0;

      let segs = segsFor(id);
      if (segs.length === 0 && isFlow) {
        let s = Infinity, e = -Infinity, err = false;
        for (const c of inner.nodes) for (const r of (runsByNode.get(c.id) ?? [])) { s = Math.min(s, r.start); e = Math.max(e, r.end); err = err || r.hasError; }
        if (e >= s) segs = [{ start: s, end: e, hasError: err, status: err ? 'failed' : (execDone ? 'success' : 'running') }];
      }

      const visibleInner = inner.nodes.filter(isVisibleInTree as any);
      const r = rel[id] || { preds: [], succs: [] };
      rows.push({
        id, label: nodeNameMap.get(id) || n?.data?.label || id, depth, type,
        runs: segs, rowStatus: rowStatusFor(id, segs),
        preds: r.preds, succs: r.succs,
        isFlow, selectable: true, hasChildren: visibleInner.length > 0,
      });

      if (visibleInner.length > 0) {
        const childRel = buildRelations(inner.nodes as any, inner.edges as any);
        for (const c of topologicalSort(visibleInner as any, inner.edges as any)) {
          pushNode(c, depth + 1, childRel as any);
        }
      }
    };

    // top-level, topologically ordered like the node tree
    for (const n of topologicalSort(nodes.filter(isVisibleInTree as any) as any, edges as any)) {
      pushNode(n, 0, topRelations as any);
    }

    // Second pass: stamp parentId on rows whose depth > their preceding flow-node row.
    // (Simpler than threading it through the recursion above.)
    const flowStack: { id: string; depth: number }[] = [];
    for (const row of rows) {
      if (row.id === '__flow__') continue;
      while (flowStack.length && flowStack[flowStack.length - 1].depth >= row.depth) flowStack.pop();
      if (flowStack.length) row.parentId = flowStack[flowStack.length - 1].id;
      if (row.hasChildren) flowStack.push({ id: row.id, depth: row.depth });
    }

    return { rows, flowStart, totalSpan };
  }, [exec, nodes, edges, nodeNameMap, statuses]);

  const ticks = useMemo(() => {
    const out: { pct: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) out.push({ pct: (i / 4) * 100, label: formatDurationShort((i / 4) * totalSpan) });
    return out;
  }, [totalSpan]);

  const rowById = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);
  const isHidden = (r: Row): boolean => {
    let p = r.parentId;
    const seen = new Set<string>();
    while (p && !seen.has(p)) { if (collapsed.has(p)) return true; seen.add(p); p = rowById.get(p)?.parentId; }
    return false;
  };

  const LABEL_W = 230;

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: 'var(--bg-2)' }}>
      {/* Axis header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: LABEL_W, flexShrink: 0, padding: '6px 10px' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Nodes</span>
        </div>
        <div style={{ position: 'relative', flex: 1, height: 26 }}>
          {ticks.map((t, i) => (
            <div key={i} style={{ position: 'absolute', left: `${t.pct}%`, top: 0, bottom: 0 }}>
              <div style={{ height: '100%', borderLeft: '1px dashed var(--border)' }} />
              <span style={{ position: 'absolute', top: 6, left: i === ticks.length - 1 ? undefined : 3, right: i === ticks.length - 1 ? 3 : undefined, fontSize: 9, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                {t.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Rows */}
      {rows.filter(r => !isHidden(r)).map(row => {
        const isSel = !!selectedNodeId && selectedNodeId === row.id;
        const isCollapsed = collapsed.has(row.id);
        const lastRun = row.runs[row.runs.length - 1];
        const lastDur = lastRun ? lastRun.end - lastRun.start : null;
        const totalActive = row.runs.reduce((a, r) => a + (r.end - r.start), 0);
        const rightmost = row.runs.length ? Math.max(...row.runs.map(r => r.end)) : flowStart;
        const rightPct = ((rightmost - flowStart) / totalSpan) * 100;
        const labelOnLeft = rightPct > 78;
        const summary = row.runs.length > 1
          ? `×${row.runs.length} · ${formatDurationShort(lastDur)} (last)`
          : formatDurationShort(lastDur);
        const isFlowRoot = row.id === '__flow__';
        return (
          <div
            key={row.id}
            onClick={() => { if (onSelect) onSelect(row.selectable ? (selectedNodeId === row.id ? null : row.id) : null); }}
            className="text-xs select-none"
            style={{
              display: 'flex', alignItems: 'center', minHeight: 24,
              borderBottom: '1px solid var(--border)',
              background: isSel ? 'var(--accent-soft)' : isFlowRoot ? 'var(--surface-2)' : 'transparent',
              cursor: 'pointer',
              color: isFlowRoot ? 'var(--text)' : 'var(--text-2)',
            }}
          >
            <div
              className="flex items-center gap-1"
              style={{ width: LABEL_W, flexShrink: 0, padding: `2px 8px 2px ${8 + row.depth * 14}px`, fontWeight: isFlowRoot ? 600 : 400 }}
              title={row.runs.length > 1 ? `${row.label} — ${row.runs.length} runs, total ${formatDurationShort(totalActive)}` : row.label}
            >
              {row.hasChildren ? (
                <button
                  onClick={e => { e.stopPropagation(); toggleCollapse(row.id); }}
                  className="p-0 flex-shrink-0"
                  style={{ color: 'var(--text-3)' }}
                  title={isCollapsed ? 'Expand inner nodes' : 'Collapse inner nodes'}
                >
                  {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              ) : (
                <span className="w-3 h-3 flex-shrink-0" />
              )}
              {isFlowRoot
                ? <GitBranch className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
                : <NodeIcon type={row.type || 'javascript'} />}
              <span className="truncate flex-1 ml-1">{row.label}</span>
              {row.runs.length > 1 && (
                <span className="flex-shrink-0 text-[10px] leading-none px-1 py-0.5 rounded" style={{ background: 'var(--bg-3)', color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>×{row.runs.length}</span>
              )}
              {/**
              <RelationBadge direction="in" items={row.preds} />
              <RelationBadge direction="out" items={row.succs} />
              **/}
              <StatusIcon status={toExecStatus(row.rowStatus)} />
            </div>
            <div style={{ position: 'relative', flex: 1, height: 16 }}>
              {row.runs.map((r, i) => {
                const leftPct = ((r.start - flowStart) / totalSpan) * 100;
                const widthPct = Math.max(((r.end - r.start) / totalSpan) * 100, 0);
                const color = STATUS_COLOR[r.status] ?? 'var(--text-mute)';
                const dur = r.end - r.start;
                return (
                  <div
                    key={i}
                    title={`${row.label}${row.runs.length > 1 ? ` · run ${i + 1}/${row.runs.length}` : ''} · +${formatDurationShort(r.start - flowStart)} → ${formatDurationShort(dur)} · ${r.status}`}
                    style={{
                      position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`,
                      minWidth: 3, top: 2, height: 12, borderRadius: 3,
                      background: color, opacity: r.status === 'running' ? 0.85 : 1,
                      boxShadow: i > 0 ? 'inset 1px 0 0 var(--bg-2)' : undefined,
                    }}
                  />
                );
              })}
              {row.runs.length > 0 ? (
                <span style={{
                  position: 'absolute', top: 1,
                  left: labelOnLeft ? undefined : `calc(${rightPct}% + 6px)`,
                  right: labelOnLeft ? `calc(${100 - ((row.runs[0].start - flowStart) / totalSpan) * 100}% + 6px)` : undefined,
                  fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap',
                }}>
                  {/**{summary}**/}
                </span>
              ) : (
                <span style={{ position: 'absolute', top: 1, left: 4, fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--text-mute)', fontStyle: 'italic' }}>not run</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ExecutionTimeline;
