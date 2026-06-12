import React, { useEffect, useMemo, useState } from 'react';
import {
  Code2, Hash, GitBranch, FileCode, Server, Coffee, Terminal,
  TerminalSquare, MessageSquare, CornerRightDown, ChevronRight,
  ChevronDown, Circle, ArrowDownLeft, ArrowUpRight,
  Loader2, CheckCircle2, AlertCircle, RefreshCw, Folder as FolderIcon, FolderOpen,
  FileText, Download,
} from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { apiClient } from '../../utils/apiClient';
import { TransferModal, type TransferState } from '../flows/TransferModal';
import { RepoFileViewer, type RepoFile } from './RepoFileViewer';
import { Node, Edge } from 'reactflow';

// A user-pushed (non-managed) file/folder in the flow's committed git tree,
// mirroring ExtraEntry in the server materializer.
interface ExtraEntry { name: string; path: string; type: 'file' | 'dir'; size?: number; children?: ExtraEntry[] }



// Mirror the server materializer (flowMaterialize.ts) so the tree matches a real
// `git clone`: leaf code nodes → nodes/<camelLabel>.<ext>, flow nodes →
// sessions/<camelLabel>/ holding their own nodes/ + sessions/ recursively.
const LANG_TO_EXT: Record<string, string> = {
  powershell: 'ps1', groovy: 'groovy', python: 'py', javascript: 'js', jsbackend: 'js',
  typescript: 'ts', batch: 'bat', bash: 'sh', shell: 'sh', sh: 'sh', sql: 'sql',
  json: 'json', yaml: 'yaml', html: 'html', css: 'css', playwright: 'js',
};
function extForNode(node: Node): string {
  const lang = node?.data?.language;
  const type = node?.data?.type;
  const key = ((typeof lang === 'string' && lang) || (typeof type === 'string' && type) || '').toLowerCase();
  return LANG_TO_EXT[key] || 'txt';
}
function sanitize(s: string): string { return String(s).replace(/[^A-Za-z0-9._-]/g, '_'); }
function camelCase(s: string): string {
  const parts = String(s || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
}
function baseName(node: Node): string { return camelCase(node?.data?.label || '') || sanitize(String(node?.id ?? 'node')); }
function uniqueName(candidate: string, used: Set<string>): string {
  let name = candidate; let n = 1;
  while (used.has(name)) name = `${candidate}_${n++}`;
  used.add(name);
  return name;
}

// A flow node embeds its sub-graph as JSON in data.code.
function parseSub(node: Node): { nodes: Node[]; edges: Edge[] } | null {
  if (node?.data?.type !== 'flow' || typeof node?.data?.code !== 'string' || !node.data.code.trim()) return null;
  try {
    const o = JSON.parse(node.data.code);
    if (Array.isArray(o?.nodes) && Array.isArray(o?.edges)) return { nodes: o.nodes, edges: o.edges };
  } catch { /* not a graph */ }
  return null;
}
const isFlowSession = (n: Node) => parseSub(n) !== null;
// File = anything with source code that isn't an expandable flow session
// (matches the materializer's "typeof data.code === 'string'" externalization).
const isFile = (n: Node) => !isFlowSession(n) && typeof n?.data?.code === 'string';

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case 'running': return <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} />;
    case 'retrying': return <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: 'var(--warn)' }} />;
    case 'success': return <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--ok)' }} />;
    case 'failed': return <AlertCircle className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--err)' }} />;
    default: return null;
  }
}

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

interface NodeRelations { preds: { id: string; label: string }[]; succs: { id: string; label: string }[]; }

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

// A collapsible folder row (nodes/ , sessions/ , or a session's <name>/).
function Folder({ name, depth, children, defaultOpen = true }: { name: string; depth: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1 cursor-pointer rounded-sm text-xs select-none hover:bg-white/5"
        style={{ paddingLeft: `${8 + depth * 14}px`, color: 'var(--text-3)' }}
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
        {open ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent)' }} /> : <FolderIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />}
        <span className="truncate ml-1" style={{ fontFamily: 'var(--font-mono)' }}>{name}</span>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

interface Handlers {
  editingNodeId: string | null;
  modifiedNodeIds: Set<string>;
  onSelect: (node: Node, parentFlow: Node | null) => void;
}

function FileRow({ name, node, depth, parentFlow, relations, editingNodeId, modifiedNodeIds, onSelect }: Handlers & {
  name: string; node: Node; depth: number; parentFlow: Node | null; relations: Record<string, NodeRelations>;
}) {
  const type = node.data?.type || 'javascript';
  const isEditing = editingNodeId === node.id;
  const isModified = modifiedNodeIds.has(node.id);
  const rel = relations[node.id] || { preds: [], succs: [] };
  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded-sm text-xs select-none ${isEditing ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-white/5 text-gray-300'}`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => onSelect(node, parentFlow)}
    >
      <span className="w-3 h-3 flex-shrink-0" />
      <NodeIcon type={type} />
      <span className="truncate flex-1 ml-1" style={{ fontFamily: 'var(--font-mono)' }}>{name}</span>
      <RelationBadge direction="in" items={rel.preds} />
      <RelationBadge direction="out" items={rel.succs} />
      {isModified && <Circle className="w-1.5 h-1.5 fill-orange-400 text-orange-400 flex-shrink-0" />}
      <StatusIcon status={(node.data as any)?.executionStatus} />
    </div>
  );
}

// Render one graph level as nodes/ + sessions/ folders, recursing into sessions.
function Level({ nodes, edges, depth, parentFlow, handlers }: {
  nodes: Node[]; edges: Edge[]; depth: number; parentFlow: Node | null; handlers: Handlers;
}) {
  const relations = useMemo(() => buildRelations(nodes, edges), [nodes, edges]);
  const ordered = useMemo(() => topologicalSort(nodes, edges), [nodes, edges]);
  const files = ordered.filter(isFile);
  // One folder per *session*, not per flow node. Several flow nodes (with
  // different titles) can be bound to the same editor session via
  // data.linkedSessionId — they're the same session and were showing up as
  // duplicate folders. Collapse them by linkedSessionId, keeping the first node
  // seen (topologically ordered). Flow nodes not yet linked to a session fall
  // back to their own id so each still appears once.
  const seenSessions = new Set<string>();
  const flows = ordered.filter(isFlowSession).filter(f => {
    const key = (f.data as any)?.linkedSessionId || f.id;
    if (seenSessions.has(key)) return false;
    seenSessions.add(key);
    return true;
  });
  const usedFiles = new Set<string>();
  const usedSessions = new Set<string>();

  return (
    <>
      {files.length > 0 && (
        <Folder name="nodes/" depth={depth}>
          {files.map(n => (
            <FileRow
              key={n.id}
              name={uniqueName(`${baseName(n)}.${extForNode(n)}`, usedFiles)}
              node={n} depth={depth + 1} parentFlow={parentFlow} relations={relations} {...handlers}
            />
          ))}
        </Folder>
      )}
      {flows.length > 0 && (
        <Folder name="sessions/" depth={depth}>
          {flows.map(f => {
            const sub = parseSub(f)!;
            // Name the folder by the session name when the session was renamed,
            // else by the session id (sanitized), matching the server
            // materializer's sessions/<name|sid>/. Falls back to the node title
            // when the flow node isn't linked to a session yet.
            const sname = (f.data as any)?.sessionName;
            const sid = (f.data as any)?.linkedSessionId;
            const candidate = sname ? sanitize(String(sname)) : sid ? sanitize(String(sid)) : baseName(f);
            const folderName = uniqueName(candidate, usedSessions);
            return (
              <Folder key={f.id} name={`${folderName}/`} depth={depth + 1}>
                <Level nodes={sub.nodes} edges={sub.edges} depth={depth + 2} parentFlow={f} handlers={handlers} />
              </Folder>
            );
          })}
        </Folder>
      )}
    </>
  );
}

function ExtraFileRow({ entry, depth, onOpen, onDownload }: {
  entry: ExtraEntry; depth: number; onOpen: (e: ExtraEntry) => void; onDownload: (e: ExtraEntry) => void;
}) {
  return (
    <div
      className="group flex items-center gap-1 px-2 py-1 cursor-pointer rounded-sm text-xs select-none hover:bg-white/5 text-gray-300"
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => onOpen(entry)}
    >
      <span className="w-3 h-3 flex-shrink-0" />
      <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
      <span className="truncate flex-1 ml-1" style={{ fontFamily: 'var(--font-mono)' }}>{entry.name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDownload(entry); }}
        title="Download"
        className="opacity-0 group-hover:opacity-100 flex-shrink-0"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0 }}
      >
        <Download className="w-3 h-3" />
      </button>
    </div>
  );
}

// Render non-managed (user-pushed) repo entries recursively. Folders reuse the
// Folder row; files open a read-only viewer / download.
function ExtraTree({ entries, depth, onOpen, onDownload }: {
  entries: ExtraEntry[]; depth: number; onOpen: (e: ExtraEntry) => void; onDownload: (e: ExtraEntry) => void;
}) {
  return (
    <>
      {entries.map(e => e.type === 'dir' ? (
        <Folder key={e.path} name={`${e.name}/`} depth={depth} defaultOpen={false}>
          <ExtraTree entries={e.children || []} depth={depth + 1} onOpen={onOpen} onDownload={onDownload} />
        </Folder>
      ) : (
        <ExtraFileRow key={e.path} entry={e} depth={depth} onOpen={onOpen} onDownload={onDownload} />
      ))}
    </>
  );
}

export const NodeFileTree: React.FC = () => {
  const sessionStore = useSessionStore();
  const { nodes, edges } = useFlowStore();
  const flowState = sessionStore.getActiveFlowState();
  const editingNodeId = flowState?.editingNodeId ?? null;
  const modifiedNodeIds = useMemo(() => new Set<string>(), []);

  // Non-managed (user-pushed) repo files: surfaced read-only below the derived
  // node/session tree. Re-fetched when the flow or its active branch changes, and
  // whenever a new commit lands (updatedAt bumps on every save/commit and on the
  // poll that picks up an external git push) so the panel reflects fresh content.
  const flowId = sessionStore.getActiveSession()?.linkedFlowId || null;
  const activeBranch = useFlowLibraryStore(s => s.flows.find(f => f.id === flowId)?.activeBranch);
  const flowUpdatedAt = useFlowLibraryStore(s => s.flows.find(f => f.id === flowId)?.updatedAt);
  const [extra, setExtra] = useState<ExtraEntry[]>([]);
  const [viewer, setViewer] = useState<RepoFile | null>(null);
  const [transfer, setTransfer] = useState<TransferState | null>(null);

  useEffect(() => {
    if (!flowId) { setExtra([]); return; }
    let cancelled = false;
    apiClient.get<{ entries: ExtraEntry[] }>(`/api/v1/flows/${flowId}/tree/extra`)
      .then(r => { if (!cancelled) setExtra(Array.isArray(r?.entries) ? r.entries : []); })
      .catch(() => { if (!cancelled) setExtra([]); });
    return () => { cancelled = true; };
  }, [flowId, activeBranch, flowUpdatedAt]);

  const openExtraFile = async (e: ExtraEntry) => {
    if (!flowId) return;
    try {
      const r = await apiClient.get<{ name: string; viewable: boolean; content?: string }>(
        `/api/v1/flows/${flowId}/tree/file?path=${encodeURIComponent(e.path)}`,
      );
      if (r?.viewable && typeof r.content === 'string') {
        setViewer({ name: r.name, path: e.path, content: r.content });
      } else {
        downloadExtraFile(e); // binary / too large → fall back to download
      }
    } catch (err) {
      console.error('open repo file failed', err);
    }
  };

  const downloadExtraFile = async (e: ExtraEntry) => {
    if (!flowId) return;
    const patch = (p: Partial<{ pct: number; done: boolean; error?: string }>) =>
      setTransfer(prev => prev ? { ...prev, items: prev.items.map((u, i) => i === 0 ? { ...u, ...p } : u) } : prev);
    setTransfer({ mode: 'download', items: [{ name: e.name, pct: 0, done: false }] });
    try {
      const blob = await apiClient.downloadBinary(
        `/api/v1/flows/${flowId}/tree/raw?path=${encodeURIComponent(e.path)}`,
        (pct) => patch({ pct }),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = e.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      patch({ pct: 100, done: true });
    } catch (err: any) {
      console.error('repo file download failed', err);
      patch({ done: true, error: err?.message || 'failed' });
    }
    setTimeout(() => setTransfer(prev => (prev && prev.items.some(u => u.error)) ? prev : null), 1200);
  };

  // Click handler. If `parentFlow` is provided, the clicked node lives inside the
  // parent flow node's serialized sub-graph; hop into its linked session first.
  const handleSelect = async (node: Node, parentFlow: Node | null) => {
    if (typeof node.data?.code !== 'string') return;

    if (!parentFlow) { sessionStore.openNodeEditor(node.id); return; }

    let linkedId: string | undefined = parentFlow.data?.linkedSessionId;
    let linked = linkedId ? sessionStore.sessions.find(s => s.id === linkedId) : undefined;

    if (!linked) {
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
      if (originalSessionId) {
        useSessionStore.setState(state => ({
          sessions: state.sessions.map(s =>
            s.id === originalSessionId
              ? { ...s, flowState: { ...s.flowState, nodes: s.flowState.nodes.map(n => n.id === parentFlow.id ? { ...n, data: { ...n.data, linkedSessionId: newSessionId } } : n) } }
              : s
          ),
        }));
        sessionStore.saveSessions();
      }
      linkedId = newSessionId;
    } else {
      sessionStore.switchSession(linkedId!);
    }
    sessionStore.openNodeEditor(node.id);
  };

  const handlers: Handlers = { editingNodeId, modifiedNodeIds, onSelect: handleSelect };

  return (
    <div className="h-full overflow-y-auto py-2" style={{ background: 'var(--bg-2)', borderRight: '1px solid var(--border)' }}>
      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
        Files
      </div>
      {nodes.length === 0 ? (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>No nodes</div>
      ) : (
        <Level nodes={nodes} edges={edges} depth={0} parentFlow={null} handlers={handlers} />
      )}

      {extra.length > 0 && (
        <>
          <div className="px-3 py-1.5 mt-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>
            Repository files
          </div>
          <ExtraTree entries={extra} depth={0} onOpen={openExtraFile} onDownload={downloadExtraFile} />
        </>
      )}

      {viewer && (
        <RepoFileViewer file={viewer} onClose={() => setViewer(null)} onDownload={() => downloadExtraFile({ name: viewer.name, path: viewer.path, type: 'file' })} />
      )}
      <TransferModal transfer={transfer} onClose={() => setTransfer(null)} />
    </div>
  );
};

export default NodeFileTree;
