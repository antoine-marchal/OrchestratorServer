import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { CheckCircle2, AlertCircle, Loader2, Clock, RefreshCw, SkipForward, ChevronRight, ChevronDown } from 'lucide-react';
import { apiClient, getJwt } from '../../utils/apiClient';
import { NODE_TYPES } from '../../constants/nodeTypes';

// Hide the default ReactFlow connection-handle dots since they look noisy in
// a read-only graph. We still need <Handle> components mounted so edges anchor
// correctly, just visually invisible.
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

interface ExecutionNodeData {
  label?: string;
  id?: string;
  type?: string;
  isFlowNode?: boolean;
  hasInner?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  innerChildren?: { id: string; label: string; type?: string; status: NodeExecStatus; attempt?: number }[];
  executionStatus?: NodeExecStatus;
  executionAttempt?: number;
}

function ExecutionNode({ data }: { data: ExecutionNodeData }) {
  const status: NodeExecStatus = data.executionStatus ?? 'pending';
  const isFlow = !!data.isFlowNode;
  const hasInner = !!data.hasInner;
  const expanded = !!data.expanded;
  const type = data.type;

  // Whole-node click expands/collapses flow nodes — more discoverable than the
  // chevron and immune to ReactFlow swallowing button clicks on read-only nodes.
  const handleHeaderClick = (e: React.MouseEvent) => {
    if (!isFlow || !hasInner) return;
    e.stopPropagation();
    data.onToggleExpand?.();
  };

  return (
    <div
      onClick={handleHeaderClick}
      style={{
        background: statusBg(status),
        border: statusBorder(status),
        borderRadius: 8,
        minWidth: isFlow ? 220 : 180,
        padding: '8px 12px',
        position: 'relative',
        cursor: isFlow && hasInner ? 'pointer' : 'default',
        boxShadow: status === 'running' ? '0 0 0 3px rgba(59,130,246,0.15)' : 'none',
        transition: 'border-color 200ms, box-shadow 200ms, background 200ms',
      }}
    >
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <div className="flex items-center gap-2">
        {isFlow && hasInner && (
          expanded ? <ChevronDown size={13} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={13} style={{ color: 'var(--text-3)' }} />
        )}
        <NodeTypeIcon type={type} size={15} />
        <span className="text-xs font-medium truncate" style={{ color: 'var(--text)', maxWidth: 160 }}>
          {data.label ?? data.id}
        </span>
        <span className="ml-auto" />
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
            <div key={child.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
              <NodeTypeIcon type={child.type} size={11} />
              <span className="truncate flex-1" style={{ maxWidth: 140 }}>{child.label}</span>
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
  /** Pre-parsed flow definition `{ nodes, edges }` — should be the snapshot
   *  of the *selected* execution, not necessarily the current flow definition. */
  flowDefinition?: { nodes: any[]; edges: any[] } | null;
  workerBaseUrl?: string;
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
  workerBaseUrl,
}) => {
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sseRef = useRef<EventSource | null>(null);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // Reset overlays whenever the user picks a different execution so stale
  // statuses from the previous one don't bleed into the new graph.
  useEffect(() => {
    setNodeStatuses({});
    setExpanded({});
  }, [executionId]);

  const innerByParent = useMemo(() => {
    const map: Record<string, any[]> = {};
    if (!flowDefinition?.nodes) return map;
    for (const n of flowDefinition.nodes) {
      if (n?.data?.type === 'flow') {
        const inner = parseInnerFlow(n);
        if (inner) map[n.id] = inner.nodes;
      }
    }
    return map;
  }, [flowDefinition]);

  // Comment and variable nodes are noise in the execution graph; goto stays
  // because it represents real control flow (its conditional jumps are
  // rendered as lighter dashed edges below).
  const HIDDEN_TYPES = useMemo(() => new Set(['comment', 'variable']), []);
  const visibleNodes = useMemo(
    () => (flowDefinition?.nodes || []).filter((n: any) => !HIDDEN_TYPES.has(n?.data?.type)),
    [flowDefinition, HIDDEN_TYPES],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n: any) => n.id)), [visibleNodes]);

  useEffect(() => {
    if (!visibleNodes.length) return;
    const mapped = visibleNodes.map((n: any, i: number) => {
      const isFlow = n?.data?.type === 'flow';
      const hasInner = isFlow && Array.isArray(innerByParent[n.id]) && innerByParent[n.id].length > 0;
      let status: NodeExecStatus = nodeStatuses[n.id]?.status ?? 'pending';
      const attempt = nodeStatuses[n.id]?.attempt;

      let innerChildren: ExecutionNodeData['innerChildren'] = undefined;
      if (hasInner) {
        innerChildren = innerByParent[n.id].map(child => ({
          id: child.id,
          label: child.data?.label ?? child.id,
          type: child.data?.type,
          status: nodeStatuses[child.id]?.status ?? 'pending',
          attempt: nodeStatuses[child.id]?.attempt,
        }));
        if (!nodeStatuses[n.id]) {
          status = aggregateStatus(innerChildren as any);
        }
      }

      return {
        id: n.id,
        type: 'execution',
        position: n.position ?? { x: i * 220, y: 0 },
        data: {
          ...n.data,
          type: n.data?.type,
          isFlowNode: isFlow,
          hasInner,
          expanded: !!expanded[n.id],
          onToggleExpand: () => setExpanded(e => ({ ...e, [n.id]: !e[n.id] })),
          innerChildren,
          executionStatus: status,
          executionAttempt: attempt,
        } as ExecutionNodeData,
        draggable: false,
      };
    });
    setRfNodes(mapped);
  }, [visibleNodes, nodeStatuses, expanded, innerByParent]);

  useEffect(() => {
    if (!flowDefinition) return;
    // 1) Real edges, but drop any whose endpoint we hid (comment/variable).
    const baseEdges = (flowDefinition.edges || [])
      .filter((e: any) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
      .map((e: any) => {
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

    // 2) Synthetic edges from goto nodes' conditions. The static edges array
    //    only captures explicit graph wiring; goto conditional jumps are
    //    declared in node.data.conditions as `{expr, goto, forwardInput}`.
    //    Render those as lighter dashed edges so they're visually distinct
    //    from the regular control flow but still legible.
    const gotoEdges: any[] = [];
    for (const n of visibleNodes) {
      if (n?.data?.type !== 'goto') continue;
      const rules = Array.isArray(n.data?.conditions) ? n.data.conditions : [];
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (!r?.goto || !visibleNodeIds.has(r.goto)) continue;
        gotoEdges.push({
          id: `goto:${n.id}:${i}:${r.goto}`,
          source: n.id,
          target: r.goto,
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

    setRfEdges([...baseEdges, ...gotoEdges]);
  }, [flowDefinition, nodeStatuses, visibleNodes, visibleNodeIds]);

  useEffect(() => {
    if (!executionId) return;
    const base = workerBaseUrl ?? apiClient.getBaseUrl().replace('/api/v1', '');
    const jwt = getJwt();
    const url = `${base}/api/v1/executions/${executionId}/stream${jwt ? `?token=${encodeURIComponent(jwt)}` : ''}`;

    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.nodeId && data.status) {
          setNodeStatuses(prev => ({
            ...prev,
            [data.nodeId]: {
              status: data.status as NodeExecStatus,
              attempt: data.attempt,
              parentNodeId: data.parentNodeId ?? null,
            },
          }));
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => { es.close(); };

    return () => { es.close(); sseRef.current = null; };
  }, [executionId, workerBaseUrl]);

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
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
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
