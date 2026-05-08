import React, { useMemo, useState } from 'react';
import {
  Code2, Hash, GitBranch, FileCode, Server, Coffee, Terminal,
  TerminalSquare, MessageSquare, CornerRightDown, ChevronRight,
  ChevronDown, Circle, ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useFlowStore } from '../../store/sessionFlowStore';
import { Node, Edge } from 'reactflow';

const CODE_NODE_TYPES = new Set(['javascript', 'jsbackend', 'groovy', 'batch', 'powershell', 'python', 'playwright']);
// Types that don't carry user code/sub-graph and clutter the tree.
const HIDDEN_FROM_TREE = new Set(['goto', 'comment', 'variable']);
const isVisibleInTree = (n: Node) => !HIDDEN_FROM_TREE.has(n.data?.type || 'javascript');

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

interface NodeRelations {
  preds: { id: string; label: string }[];
  succs: { id: string; label: string }[];
}

// Topological sort (Kahn's algorithm) — returns nodes in execution order.
// Disconnected nodes and cycles are appended at the end in original order.
function topologicalSort(nodes: Node[], edges: Edge[]): Node[] {
  const nodeById = new Map<string, Node>();
  for (const n of nodes) nodeById.set(n.id, n);

  const inDegree = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const n of nodes) { inDegree.set(n.id, 0); successors.set(n.id, []); }
  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    successors.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  }

  const queue: Node[] = nodes.filter(n => inDegree.get(n.id) === 0);
  const sorted: Node[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    sorted.push(node);
    for (const succId of successors.get(node.id) || []) {
      const deg = (inDegree.get(succId) || 1) - 1;
      inDegree.set(succId, deg);
      if (deg === 0) { const s = nodeById.get(succId); if (s) queue.push(s); }
    }
  }
  for (const n of nodes) { if (!visited.has(n.id)) sorted.push(n); }
  return sorted;
}

// Compute predecessor/successor lists for every node id in a flow definition.
// Children inside flow nodes get their own (sub-graph) relations; top-level
// nodes use the parent flow's edges.
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

function NodeItem({ node, depth, editingNodeId, onSelect, modifiedNodeIds, parentFlow, relations }: {
  node: Node;
  depth: number;
  editingNodeId: string | null;
  onSelect: (node: Node, parentFlow: Node | null) => void;
  modifiedNodeIds: Set<string>;
  parentFlow: Node | null;
  relations: Record<string, NodeRelations>;
}) {
  const [expanded, setExpanded] = useState(true);
  const type = node.data?.type || 'javascript';
  const isFlow = type === 'flow';
  const isEditing = editingNodeId === node.id;
  const isModified = modifiedNodeIds.has(node.id);
  const isCode = CODE_NODE_TYPES.has(type);

  // Parse child nodes + edges from flow code so children render with their
  // own sub-graph relations rather than stale parent-graph ones.
  let childNodes: Node[] = [];
  let childEdges: Edge[] = [];
  if (isFlow && node.data?.code) {
    try {
      const flowData = JSON.parse(node.data.code);
      if (Array.isArray(flowData.nodes)) childNodes = flowData.nodes;
      if (Array.isArray(flowData.edges)) childEdges = flowData.edges;
    } catch { }
  }
  const childRelations = useMemo(
    () => isFlow && childNodes.length > 0 ? buildRelations(childNodes, childEdges) : {},
    [childNodes, childEdges, isFlow]
  );

  const rel = relations[node.id] || { preds: [], succs: [] };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded-sm text-xs select-none
          ${isEditing ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-white/5 text-gray-300'}
          ${!isCode && !isFlow ? 'opacity-60' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onSelect(node, parentFlow)}
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
        {isModified && <Circle className="w-1.5 h-1.5 fill-orange-400 text-orange-400 flex-shrink-0" />}
      </div>
      {isFlow && expanded && childNodes.length > 0 && (
        <div>
          {topologicalSort(childNodes, childEdges).filter(isVisibleInTree).map((child: Node) => (
            <NodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              editingNodeId={editingNodeId}
              onSelect={onSelect}
              modifiedNodeIds={modifiedNodeIds}
              parentFlow={node}
              relations={childRelations}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const NodeFileTree: React.FC = () => {
  const sessionStore = useSessionStore();
  const { nodes, edges } = useFlowStore();
  const flowState = sessionStore.getActiveFlowState();
  const editingNodeId = flowState?.editingNodeId ?? null;

  const modifiedNodeIds = new Set<string>();
  const relations = useMemo(() => buildRelations(nodes, edges), [nodes, edges]);

  // Click handler. If `parentFlow` is provided, the clicked node lives inside
  // the parent flow node's serialized sub-graph, not in the active session.
  // We need to hop into the flow node's linked session (creating one on the
  // fly if missing), then open the sub-node's editor inside that session.
  const handleSelect = async (node: Node, parentFlow: Node | null) => {
    const type = node.data?.type || 'javascript';
    if (!CODE_NODE_TYPES.has(type)) return;

    if (!parentFlow) {
      sessionStore.openNodeEditor(node.id);
      return;
    }

    // Ensure the flow node has a linked session that contains its children.
    let linkedId: string | undefined = parentFlow.data?.linkedSessionId;
    let linked = linkedId ? sessionStore.sessions.find(s => s.id === linkedId) : undefined;

    if (!linked) {
      // Mirrors NodeHeader.handleEditFlowNode: create a session, parse contents,
      // store back the linkedSessionId on the parent.
      const originalSessionId = sessionStore.activeSessionId;
      const parentFlowId = sessionStore.getActiveSession()?.linkedFlowId;
      const newSessionId = await sessionStore.createSession(parentFlow.data?.label || 'Flow Session', parentFlowId);
      const flowCode = parentFlow.data?.code || '';
      if (flowCode.trim()) {
        try {
          const parsed = JSON.parse(flowCode);
          if (parsed?.nodes && parsed?.edges) {
            sessionStore.updateActiveFlowState({
              nodes: parsed.nodes.map((n: any) => ({ ...n, data: { ...n.data, output: undefined, executionTime: undefined } })),
              edges: parsed.edges,
              flowPath: parentFlow.data?.label || 'Flow Session',
              history: [],
              historyIndex: -1,
            });
          }
        } catch { /* leave session empty on parse error */ }
      }
      // Stamp linkedSessionId back into the original session's flow node.
      if (originalSessionId) {
        useSessionStore.setState(state => ({
          sessions: state.sessions.map(s =>
            s.id === originalSessionId
              ? {
                  ...s,
                  flowState: {
                    ...s.flowState,
                    nodes: s.flowState.nodes.map(n =>
                      n.id === parentFlow.id ? { ...n, data: { ...n.data, linkedSessionId: newSessionId } } : n
                    ),
                  },
                }
              : s
          ),
        }));
        sessionStore.saveSessions();
      }
      linkedId = newSessionId;
    } else {
      sessionStore.switchSession(linkedId!);
    }
    // Now we're inside the flow node's session; open the child's code panel.
    sessionStore.openNodeEditor(node.id);
  };

  return (
    <div className="h-full overflow-y-auto py-2" style={{ background: 'var(--bg-2)', borderRight: '1px solid var(--border)' }}>
      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
        Nodes
      </div>
      {nodes.length === 0 ? (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>No nodes</div>
      ) : (
        topologicalSort(nodes, edges).filter(isVisibleInTree).map(node => (
          <NodeItem
            key={node.id}
            node={node}
            depth={0}
            editingNodeId={editingNodeId}
            onSelect={handleSelect}
            modifiedNodeIds={modifiedNodeIds}
            parentFlow={null}
            relations={relations}
          />
        ))
      )}
    </div>
  );
};

export default NodeFileTree;
