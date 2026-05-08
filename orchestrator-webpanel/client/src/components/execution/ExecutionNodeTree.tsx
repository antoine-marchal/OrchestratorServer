import React, { useMemo, useState } from 'react';
import {
  Code2, Hash, GitBranch, FileCode, Server, Coffee, Terminal,
  TerminalSquare, MessageSquare, CornerRightDown, ChevronRight,
  ChevronDown, ArrowDownLeft, ArrowUpRight,
  Loader2, CheckCircle2, AlertCircle, RefreshCw, SkipForward, Clock,
} from 'lucide-react';
import { Node, Edge } from 'reactflow';

const HIDDEN_TYPES = new Set(['comment', 'variable']);
const isVisibleInTree = (n: Node) => !HIDDEN_TYPES.has(n.data?.type || '');

function NodeIcon({ type }: { type: string }) {
  switch (type) {
    case 'variable': return <Hash className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />;
    case 'flow': return <GitBranch className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />;
    case 'javascript': return <FileCode className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />;
    case 'jsbackend': return <Server className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />;
    case 'groovy': return <Coffee className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />;
    case 'batch': return <Terminal className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />;
    case 'powershell': return <TerminalSquare className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />;
    case 'python': return <Code2 className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />;
    case 'goto': return <CornerRightDown className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />;
    case 'comment': return <MessageSquare className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />;
    default: return <Code2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />;
  }
}

export type NodeExecStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'retrying';

function StatusIcon({ status }: { status?: NodeExecStatus }) {
  switch (status) {
    case 'running': return <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--accent)' }} />;
    case 'success': return <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--ok)' }} />;
    case 'failed': return <AlertCircle className="w-3 h-3" style={{ color: 'var(--err)' }} />;
    case 'retrying': return <RefreshCw className="w-3 h-3 animate-spin" style={{ color: 'var(--warn)' }} />;
    case 'skipped': return <SkipForward className="w-3 h-3" style={{ color: 'var(--text-3)' }} />;
    case 'pending': return <Clock className="w-3 h-3" style={{ color: 'var(--text-3)' }} />;
    default: return null;
  }
}

interface NodeRelations {
  preds: { id: string; label: string }[];
  succs: { id: string; label: string }[];
}

function buildRelations(nodes: Node[], edges: Edge[]): Record<string, NodeRelations> {
  const labelById = new Map<string, string>();
  for (const n of nodes) labelById.set(n.id, n.data?.label || n.id);
  const map: Record<string, NodeRelations> = {};
  for (const n of nodes) map[n.id] = { preds: [], succs: [] };
  for (const e of edges || []) {
    const srcLabel = labelById.get(e.source) || e.source;
    const tgtLabel = labelById.get(e.target) || e.target;
    if (map[e.source]) map[e.source].succs.push({ id: e.target, label: tgtLabel });
    if (map[e.target]) map[e.target].preds.push({ id: e.source, label: srcLabel });
  }
  return map;
}

function summarize(items: { label: string }[]): string {
  if (!items.length) return '';
  if (items.length === 1) return items[0].label;
  return `${items[0].label} +${items.length - 1}`;
}

function RelationBadge({ direction, items }: { direction: 'in' | 'out'; items: { id: string; label: string }[] }) {
  if (!items.length) return null;
  const Icon = direction === 'in' ? ArrowDownLeft : ArrowUpRight;
  const tooltip = items.map(i => `${direction === 'in' ? '← ' : '→ '}${i.label}`).join('\n');
  return (
    <span
      title={tooltip}
      className="flex items-center gap-0.5 flex-shrink-0 text-[10px] leading-none px-1 py-0.5 rounded"
      style={{ background: 'var(--bg-3)', color: direction === 'in' ? 'var(--text-3)' : 'var(--accent)', fontFamily: 'var(--font-mono)' }}
    >
      <Icon className="w-2.5 h-2.5" />
      <span className="truncate" style={{ maxWidth: 60 }}>{summarize(items)}</span>
    </span>
  );
}

interface NodeItemProps {
  node: Node;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  relations: Record<string, NodeRelations>;
  statuses: Record<string, NodeExecStatus | undefined>;
}

function NodeItemView({ node, depth, selectedId, onSelect, relations, statuses }: NodeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const type = node.data?.type || 'javascript';
  const isFlow = type === 'flow';
  const isSelected = selectedId === node.id;
  const status = statuses[node.id];

  // Parse children + edges from flow node so sub-tree shows the right local
  // relations rather than the parent flow's edge map.
  let childNodes: Node[] = [];
  let childEdges: Edge[] = [];
  if (isFlow && node.data?.code) {
    try {
      const parsed = JSON.parse(node.data.code);
      if (Array.isArray(parsed.nodes)) childNodes = parsed.nodes;
      if (Array.isArray(parsed.edges)) childEdges = parsed.edges;
    } catch { /* ignore */ }
  }
  const childRelations = useMemo(
    () => isFlow && childNodes.length > 0 ? buildRelations(childNodes, childEdges) : {},
    [childNodes, childEdges, isFlow],
  );

  const rel = relations[node.id] || { preds: [], succs: [] };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded-sm text-xs select-none
          ${isSelected ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-white/5 text-gray-300'}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        // Click toggles selection: click again to clear filter.
        onClick={() => onSelect(isSelected ? null : node.id)}
      >
        {isFlow && childNodes.length > 0 ? (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
            className="p-0 flex-shrink-0"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-3 h-3 flex-shrink-0" />
        )}
        <NodeIcon type={type} />
        <span className="truncate flex-1 ml-1">{node.data?.label || node.id}</span>
        <RelationBadge direction="in" items={rel.preds} />
        <RelationBadge direction="out" items={rel.succs} />
        <StatusIcon status={status} />
      </div>
      {isFlow && expanded && childNodes.length > 0 && (
        <div>
          {childNodes.filter(isVisibleInTree).map((child: Node) => (
            <NodeItemView
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              relations={childRelations}
              statuses={statuses}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ExecutionNodeTreeProps {
  nodes: Node[];
  edges: Edge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Optional per-node status overlay (running/success/failed/etc.). */
  statuses?: Record<string, NodeExecStatus | undefined>;
}

const ExecutionNodeTree: React.FC<ExecutionNodeTreeProps> = ({ nodes, edges, selectedId, onSelect, statuses = {} }) => {
  const relations = useMemo(() => buildRelations(nodes, edges), [nodes, edges]);
  const visible = nodes.filter(isVisibleInTree);

  return (
    <div className="h-full overflow-y-auto py-2" style={{ background: 'var(--bg-2)', borderRight: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Nodes</span>
        {selectedId && (
          <button
            onClick={() => onSelect(null)}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-3)', color: 'var(--text-3)' }}
            title="Clear filter — show logs for all nodes"
          >
            clear
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>No nodes</div>
      ) : (
        visible.map(node => (
          <NodeItemView
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            relations={relations}
            statuses={statuses}
          />
        ))
      )}
    </div>
  );
};

export default ExecutionNodeTree;
