import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { CheckCircle2, AlertCircle, Loader2, Clock, RefreshCw, SkipForward, ChevronRight, ChevronDown } from 'lucide-react';
import { NODE_TYPES } from '../../constants/nodeTypes';
import { formatDurationShort } from '../../utils/execTiming';
import { scopeKey } from '../../utils/execScope';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';

const HIDDEN_HANDLE: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  opacity: 0,
  pointerEvents: 'none',
};

const NODE_ICON_MAP = NODE_TYPES.reduce<Record<string, { Icon: any; color: string }>>((acc, t) => {
  acc[t.id] = { Icon: t.icon, color: t.iconColor };
  return acc;
}, {});

function NodeTypeIcon({ type, size = 14 }: { type?: string; size?: number }) {
  const def = type ? NODE_ICON_MAP[type] : undefined;
  if (!def) return null;
  const { Icon, color } = def;
  return <Icon size={size} className={`flex-shrink-0 ${color}`} />;
}

type NodeExecStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'retrying';

interface NodeStatus {
  status: NodeExecStatus;
  attempt?: number;
  parentNodeId?: string | null;
}

function StatusIcon({ status, size = 14 }: { status: NodeExecStatus; size?: number }) {
  switch (status) {
    case 'running': return <Loader2 size={size} className="animate-spin" style={{ color: 'var(--accent)' }} />;
    case 'success': return <CheckCircle2 size={size} style={{ color: 'var(--ok)' }} />;
    case 'failed': return <AlertCircle size={size} style={{ color: 'var(--err)' }} />;
    case 'retrying': return <RefreshCw size={size} className="animate-spin" style={{ color: 'var(--warn)' }} />;
    case 'skipped': return <SkipForward size={size} style={{ color: 'var(--text-3)' }} />;
    default: return <Clock size={size} style={{ color: 'var(--text-3)' }} />;
  }
}

function statusBorder(status: NodeExecStatus): string {
  switch (status) {
    case 'running': return '2px solid var(--accent)';
    case 'success': return '2px solid var(--ok)';
    case 'failed': return '2px solid var(--err)';
    case 'retrying': return '2px solid var(--warn)';
    default: return '1px solid var(--border)';
  }
}

function statusBg(status: NodeExecStatus): string {
  switch (status) {
    case 'running': return 'rgba(59,130,246,0.08)';
    case 'success': return 'rgba(34,197,94,0.06)';
    case 'failed': return 'rgba(239,68,68,0.08)';
    case 'retrying': return 'rgba(234,179,8,0.08)';
    default: return 'transparent';
  }
}

function aggregateStatus(children: NodeStatus[]): NodeExecStatus {
  if (!children.length) return 'pending';
  if (children.some(c => c.status === 'failed')) return 'failed';
  if (children.some(c => c.status === 'running' || c.status === 'retrying')) return 'running';
  if (children.every(c => c.status === 'success' || c.status === 'skipped')) return 'success';
  return 'pending';
}

// Compute a clean left-to-right DAG layout using longest-path ranking.
// nodeHeights allows expanded flow nodes to contribute their real rendered
// height so that downstream columns stay vertically centered correctly.
function computeLayout(
  nodes: any[],
  edges: any[],
  nodeHeights?: Map<string, number>,
): Map<string, { x: number; y: number }> {
  const NODE_W = 200;
  const DEFAULT_H = 46;
  const H_GAP = 64;
  const V_GAP = 12;

  const nodeIds = new Set(nodes.map((n: any) => n.id as string));
  const preds = new Map<string, Set<string>>();
  for (const n of nodes) preds.set(n.id, new Set());
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      preds.get(e.target)!.add(e.source);
    }
  }

  const rank = new Map<string, number>();
  const computing = new Set<string>();
  function assignRank(id: string): number {
    if (rank.has(id)) return rank.get(id)!;
    if (computing.has(id)) return 0; // cycle guard
    computing.add(id);
    let maxPred = -1;
    for (const p of preds.get(id) || []) maxPred = Math.max(maxPred, assignRank(p));
    const r = maxPred + 1;
    rank.set(id, r);
    computing.delete(id);
    return r;
  }
  for (const n of nodes) assignRank(n.id);

  const byRank = new Map<number, string[]>();
  for (const [id, r] of rank) {
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(id);
  }

  const nodeH = (id: string) => nodeHeights?.get(id) ?? DEFAULT_H;
  const colTotalH = (ids: string[]) =>
    ids.reduce((acc, id, i) => acc + nodeH(id) + (i > 0 ? V_GAP : 0), 0);

  const maxColH = Math.max(...[...byRank.values()].map(colTotalH), DEFAULT_H);

  const positions = new Map<string, { x: number; y: number }>();
  for (const [r, ids] of byRank) {
    let y = (maxColH - colTotalH(ids)) / 2;
    for (const id of ids) {
      positions.set(id, { x: r * (NODE_W + H_GAP), y });
      y += nodeH(id) + V_GAP;
    }
  }
  return positions;
}

interface ExecutionNodeData {
  label?: string;
  id?: string;
  type?: string;
  isFlowNode?: boolean;
  hasInner?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  innerChildren?: { id: string; label: string; type?: string; status: NodeExecStatus; attempt?: number; durationMs?: number | null }[];
  executionStatus?: NodeExecStatus;
  executionAttempt?: number;
  durationMs?: number | null;
  isSelected?: boolean;
  onSelect?: () => void;
}

function ExecutionNode({ data }: { data: ExecutionNodeData }) {
  const status: NodeExecStatus = data.executionStatus ?? 'pending';
  const isFlow = !!data.isFlowNode;
  const hasInner = !!data.hasInner;
  const expanded = !!data.expanded;
  const isSelected = !!data.isSelected;
  const type = data.type;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isFlow && hasInner) data.onToggleExpand?.();
    data.onSelect?.();
  };

  const border = isSelected ? '2px solid var(--accent)' : statusBorder(status);
  const shadow = isSelected
    ? '0 0 0 3px rgba(59,130,246,0.28)'
    : status === 'running' ? '0 0 0 3px rgba(59,130,246,0.15)' : 'none';

  const title = `${data.label ?? data.id ?? ''} · ${status}${data.durationMs != null ? ` · ${formatDurationShort(data.durationMs)}` : ''}`;

  return (
    <div
      onClick={handleClick}
      title={title}
      style={{
        background: statusBg(status),
        border,
        borderRadius: 8,
        minWidth: isFlow ? 200 : 160,
        padding: '7px 11px',
        position: 'relative',
        cursor: 'pointer',
        boxShadow: shadow,
        transition: 'border-color 200ms, box-shadow 200ms, background 200ms',
      }}
    >
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <div className="flex items-center gap-2">
        {isFlow && hasInner && (
          expanded
            ? <ChevronDown size={13} style={{ color: 'var(--text-3)' }} />
            : <ChevronRight size={13} style={{ color: 'var(--text-3)' }} />
        )}
        <NodeTypeIcon type={type} size={15} />
        <span className="text-xs font-medium truncate" style={{ color: 'var(--text)', maxWidth: 140 }}>
          {data.label ?? data.id}
        </span>
        <span className="ml-auto" />
        {data.durationMs != null && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {formatDurationShort(data.durationMs)}
          </span>
        )}
        <StatusIcon status={status} size={13} />
        {data.executionAttempt != null && data.executionAttempt > 1 && (
          <span className="text-xs px-1 rounded" style={{ background: 'var(--bg-3)', color: 'var(--warn)', fontSize: 10 }}>
            #{data.executionAttempt}
          </span>
        )}
      </div>

      {isFlow && expanded && data.innerChildren && data.innerChildren.length > 0 && (
        <div className="flex flex-col gap-1 mt-2 pt-2" style={{ borderTop: '1px dashed var(--border)' }}>
          {data.innerChildren.map(child => (
            <div key={child.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }} title={`${child.label} · ${child.status}${child.durationMs != null ? ` · ${formatDurationShort(child.durationMs)}` : ''}`}>
              <NodeTypeIcon type={child.type} size={11} />
              <span className="truncate flex-1" style={{ maxWidth: 120 }}>{child.label}</span>
              {child.durationMs != null && (
                <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  {formatDurationShort(child.durationMs)}
                </span>
              )}
              <StatusIcon status={child.status} size={11} />
            </div>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
    </div>
  );
}

const nodeTypes = { execution: ExecutionNode };

interface ExecutionGraphProps {
  executionId: string;
  flowDefinition?: { nodes: any[]; edges: any[] } | null;
  selectedNodeId?: string | null;
  onNodeSelect?: (id: string | null) => void;
  /** Live per-node status map (instance-scope key -> status), owned by the parent
   *  via useNodeStatuses so the graph, timeline and node tree stay in sync even
   *  when the graph panel is hidden. */
  statuses?: Record<string, NodeStatus>;
  /** Per-node wall-clock duration in ms (derived from logs by the parent). */
  nodeDurations?: Record<string, number>;
}

function parseInnerFlow(node: any): { nodes: any[]; edges: any[] } | null {
  const code = node?.data?.code;
  if (!code || typeof code !== 'string') return null;
  try {
    const parsed = JSON.parse(code);
    if (Array.isArray(parsed?.nodes) && Array.isArray(parsed?.edges)) return parsed;
  } catch { /* ignore */ }
  return null;
}

export const ExecutionGraph: React.FC<ExecutionGraphProps> = ({
  executionId,
  flowDefinition,
  selectedNodeId,
  onNodeSelect,
  statuses,
  nodeDurations,
}) => {
  // Live status now flows in from the parent (useNodeStatuses) so the graph is a
  // pure consumer — hiding it no longer starves the timeline/tree of statuses.
  const nodeStatuses = statuses ?? {};
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const onNodeSelectRef = useRef(onNodeSelect);
  onNodeSelectRef.current = onNodeSelect;

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  // Cache of built rf-nodes by id + content signature. Status/duration updates
  // arrive in bursts (SSE + 3s poll); rebuilding every node object each burst
  // makes ReactFlow re-mount/re-measure the whole graph, and an interrupted
  // measure can leave some nodes unpainted until something forces them to
  // re-render (e.g. selecting one). Reusing the SAME object reference for nodes
  // whose visible state is unchanged keeps them mounted and painted from the
  // start. See `nodeSig` below for what counts as a change.
  const nodeCache = useRef<Map<string, { sig: string; node: any }>>(new Map());

  useEffect(() => {
    setExpanded({});
    nodeCache.current.clear();
  }, [executionId]);

  // Re-fit the viewport whenever the node set OR the layout extent changes —
  // switching execution, the flow definition arriving late on a deep link, or a
  // flow node being expanded (which grows the graph). Without this, ReactFlow
  // keeps the previous pan/zoom and part of a larger graph stays off-screen —
  // the classic "I don't see all the nodes" after opening a cron/trigger run.
  // The fit signature includes each node's position so expansion re-fits too.
  const fitKey = useMemo(
    () => rfNodes.map(n => `${n.id}@${Math.round(n.position?.x ?? 0)},${Math.round(n.position?.y ?? 0)}`).join('|'),
    [rfNodes],
  );
  useEffect(() => {
    if (!rfInstance.current || rfNodes.length === 0) return;
    // minZoom mirrors the ReactFlow prop below so fitView can shrink far enough
    // to bring every node (including un-executed peripheral branches) on-screen.
    const id = requestAnimationFrame(() => rfInstance.current?.fitView({ padding: 0.18, minZoom: 0.05 }));
    return () => cancelAnimationFrame(id);
  }, [fitKey]);

  // Track every flow library entry so a flowRef-style flow node (whose `code`
  // is empty and `flowRef` points at another flow by id) can still expand to
  // show its child nodes in this graph view.
  const libraryFlows = useFlowLibraryStore(s => s.flows);
  const innerByParent = useMemo(() => {
    const map: Record<string, any[]> = {};
    if (!flowDefinition?.nodes) return map;
    for (const n of flowDefinition.nodes) {
      if (n?.data?.type !== 'flow') continue;
      const inner = parseInnerFlow(n);
      if (inner) { map[n.id] = inner.nodes; continue; }
      // flowRef path: resolve referenced flow from the library.
      const ref = n?.data?.flowRef;
      if (ref) {
        const linked = libraryFlows.find(f => f.id === ref);
        if (linked) map[n.id] = linked.nodes || [];
      }
    }
    return map;
  }, [flowDefinition, libraryFlows]);

  const HIDDEN_TYPES = useMemo(() => new Set(['comment', 'variable']), []);
  const visibleNodes = useMemo(
    () => (flowDefinition?.nodes || []).filter((n: any) => !HIDDEN_TYPES.has(n?.data?.type)),
    [flowDefinition, HIDDEN_TYPES],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n: any) => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(
    () => (flowDefinition?.edges || []).filter((e: any) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)),
    [flowDefinition, visibleNodeIds],
  );

  // Height estimate for each node: expanded flow nodes grow by one row per child.
  // These constants mirror the rendered CSS (padding 7px top+bottom, child row ~18px,
  // gap-1 between rows, mt-2 pt-2 overhead when expanded).
  const nodeHeights = useMemo(() => {
    const CHILD_ROW_H = 18;
    const EXPAND_OVERHEAD = 20; // mt-2 (8) + pt-2 (8) + border (4)
    const CHILD_GAP = 4;
    const h = new Map<string, number>();
    for (const n of visibleNodes) {
      const isFlow = n?.data?.type === 'flow';
      const children = innerByParent[n.id];
      if (isFlow && expanded[n.id] && children?.length > 0) {
        const count = children.length;
        h.set(n.id, 46 + EXPAND_OVERHEAD + count * CHILD_ROW_H + (count - 1) * CHILD_GAP);
      } else {
        h.set(n.id, 46);
      }
    }
    return h;
  }, [visibleNodes, expanded, innerByParent]);

  const computedPositions = useMemo(
    () => computeLayout(visibleNodes, visibleEdges, nodeHeights),
    [visibleNodes, visibleEdges, nodeHeights],
  );

  useEffect(() => {
    if (!visibleNodes.length) return;
    const mapped = visibleNodes.map((n: any, i: number) => {
      const isFlow = n?.data?.type === 'flow';
      const hasInner = isFlow && Array.isArray(innerByParent[n.id]) && innerByParent[n.id].length > 0;
      let status: NodeExecStatus = nodeStatuses[n.id]?.status ?? 'pending';
      const attempt = nodeStatuses[n.id]?.attempt;

      let innerChildren: ExecutionNodeData['innerChildren'] = undefined;
      if (hasInner) {
        innerChildren = innerByParent[n.id].map(child => {
          // Inner nodes are scoped under this flow node (n is top-level here).
          const childKey = scopeKey(n.id, child.id);
          return {
            id: child.id,
            label: child.data?.label ?? child.id,
            type: child.data?.type,
            status: nodeStatuses[childKey]?.status ?? 'pending',
            attempt: nodeStatuses[childKey]?.attempt,
            durationMs: nodeDurations?.[childKey] ?? null,
          };
        });
        if (!nodeStatuses[n.id]) {
          status = aggregateStatus(innerChildren as any);
        }
      }

      const nodeId = n.id;
      const position = computedPositions.get(nodeId) ?? { x: i * 264, y: 0 };
      const built = {
        id: nodeId,
        type: 'execution',
        position,
        data: {
          ...n.data,
          type: n.data?.type,
          isFlowNode: isFlow,
          hasInner,
          expanded: !!expanded[nodeId],
          onToggleExpand: () => setExpanded(e => ({ ...e, [nodeId]: !e[nodeId] })),
          innerChildren,
          executionStatus: status,
          executionAttempt: attempt,
          durationMs: nodeDurations?.[nodeId] ?? null,
          isSelected: selectedNodeId === nodeId,
          onSelect: () => {
            const fn = onNodeSelectRef.current;
            if (fn) fn(selectedNodeId === nodeId ? null : nodeId);
          },
        } as ExecutionNodeData,
        draggable: false,
      };

      // Everything that affects how the node renders. Callbacks are excluded —
      // they're re-created each pass but behave identically, and the only
      // selection case that needs a fresh closure (clicking the *selected* node
      // to deselect) already changes `isSelected`, busting the cache.
      const sig = JSON.stringify([
        position.x, position.y, status, attempt ?? null,
        nodeDurations?.[nodeId] ?? null, selectedNodeId === nodeId,
        !!expanded[nodeId], hasInner,
        innerChildren?.map(c => [c.id, c.status, c.attempt ?? null, c.durationMs ?? null]) ?? null,
        n.data?.label ?? null, n.data?.type ?? null,
      ]);
      const cached = nodeCache.current.get(nodeId);
      if (cached && cached.sig === sig) return cached.node;
      nodeCache.current.set(nodeId, { sig, node: built });
      return built;
    });
    // Drop cache entries for nodes no longer present (execution switch).
    const liveIds = new Set(mapped.map(m => m.id));
    for (const id of [...nodeCache.current.keys()]) if (!liveIds.has(id)) nodeCache.current.delete(id);
    setRfNodes(mapped);
  }, [visibleNodes, nodeStatuses, expanded, innerByParent, computedPositions, selectedNodeId, nodeDurations]);

  useEffect(() => {
    if (!flowDefinition) return;
    const baseEdges = visibleEdges.map((e: any) => {
      const targetStatus = nodeStatuses[e.target]?.status;
      const isLive = targetStatus === 'running' || targetStatus === 'retrying';
      const isDone = targetStatus === 'success';
      const isFailed = targetStatus === 'failed';
      const stroke = isFailed ? 'var(--err)' : isDone ? 'var(--ok)' : isLive ? 'var(--accent)' : 'var(--text-mute)';
      return {
        ...e,
        type: 'smoothstep',
        animated: isLive,
        style: { stroke, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      };
    });

    const gotoEdges: any[] = [];
    for (const n of visibleNodes) {
      if (n?.data?.type !== 'goto') continue;
      const rules = Array.isArray(n.data?.conditions) ? n.data.conditions : [];
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const targets: string[] = (Array.isArray(r?.goto) ? r.goto : r?.goto ? [r.goto] : []);
        for (const t of targets) {
          if (!visibleNodeIds.has(t)) continue;
          gotoEdges.push({
            id: `goto:${n.id}:${i}:${t}`,
            source: n.id,
            target: t,
            type: 'smoothstep',
            animated: false,
            style: { stroke: 'var(--text-mute)', strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.55 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-mute)', width: 12, height: 12 },
            label: r.expr ? (r.expr.length > 24 ? r.expr.slice(0, 22) + '…' : r.expr) : undefined,
            labelStyle: { fontSize: 9, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' },
            labelBgStyle: { fill: 'var(--bg-2)' },
            labelBgPadding: [3, 2] as [number, number],
          });
        }
      }
    }

    setRfEdges([...baseEdges, ...gotoEdges]);
  }, [flowDefinition, nodeStatuses, visibleNodes, visibleNodeIds, visibleEdges]);

  if (!flowDefinition?.nodes?.length) {
    return (
      <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-3)' }}>
        No flow graph available
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={inst => { rfInstance.current = inst; }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.05 }}
        minZoom={0.05}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
      </ReactFlow>
    </div>
  );
};

export default ExecutionGraph;
