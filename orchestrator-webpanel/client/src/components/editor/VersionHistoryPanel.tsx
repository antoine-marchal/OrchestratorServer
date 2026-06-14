import React, { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, Diff, RefreshCw, ChevronRight, ChevronDown, GitBranch, Copy, Check, Plus, Trash2, Scissors, ArrowDownToLine } from 'lucide-react';
import { flowGitApi } from '../../api';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useSessionStore } from '../../store/sessionStore';

interface VersionRow {
  _id: string; // commit sha
  flowId: string;
  savedAt: string;
  author?: string;
  name?: string;
  message?: string;
}

interface VersionDetail {
  _id: string;
  flowId: string;
  savedAt: string;
  author?: string;
  name?: string;
  namespace?: string;
  description?: string;
  nodes?: any[];
  edges?: any[];
  artifacts?: Array<{name: string; data: string}>;
}

interface DiffResult {
  addedNodes: any[];
  removedNodes: any[];
  changedNodes: Array<{ id: string; label: string; before: string; after: string }>;
  addedEdges: any[];
  removedEdges: any[];
}

function diffSnapshots(prev: { nodes?: any[]; edges?: any[] }, curr: { nodes?: any[]; edges?: any[] }): DiffResult {
  const prevById = new Map<string, any>();
  for (const n of prev.nodes || []) prevById.set(n.id, n);
  const currById = new Map<string, any>();
  for (const n of curr.nodes || []) currById.set(n.id, n);

  const addedNodes: any[] = [];
  const removedNodes: any[] = [];
  const changedNodes: DiffResult['changedNodes'] = [];

  for (const [id, n] of currById) {
    if (!prevById.has(id)) addedNodes.push(n);
    else {
      const p = prevById.get(id);
      const a = JSON.stringify(p?.data ?? {});
      const b = JSON.stringify(n?.data ?? {});
      if (a !== b) changedNodes.push({ id, label: n?.data?.label || id, before: a, after: b });
    }
  }
  for (const [id, n] of prevById) {
    if (!currById.has(id)) removedNodes.push(n);
  }

  const edgeKey = (e: any) => `${e.source}->${e.target}:${e.sourceHandle ?? ''}:${e.targetHandle ?? ''}`;
  const prevEdgeKeys = new Set((prev.edges || []).map(edgeKey));
  const currEdgeKeys = new Set((curr.edges || []).map(edgeKey));
  const addedEdges = (curr.edges || []).filter((e: any) => !prevEdgeKeys.has(edgeKey(e)));
  const removedEdges = (prev.edges || []).filter((e: any) => !currEdgeKeys.has(edgeKey(e)));

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges };
}

const VersionHistoryPanel: React.FC<{ flowId?: string }> = ({ flowId }) => {
  const { flows, loadAll } = useFlowLibraryStore();
  const flow = flowId ? flows.find(f => f.id === flowId) : undefined;

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [showDiff, setShowDiff] = useState(true);
  const [branches, setBranches] = useState<string[]>([]);
  const [activeBranch, setActiveBranch] = useState<string>('main');
  const [copied, setCopied] = useState(false);

  const cloneUrl = flowId ? `${window.location.origin}/git/${flowId}` : '';

  // Push the server's flow nodes/edges into the canonical editor session so the
  // canvas reflects a restore/checkout (the editor reads the session, not the
  // library). Same pattern restore relies on.
  const applyToSession = useCallback((nodes: any[], edges: any[]) => {
    if (!flowId) return;
    const sessionStore = useSessionStore.getState();
    const canonical = sessionStore.getCanonicalSession(flowId);
    if (!canonical) return;
    useSessionStore.setState(state => ({
      sessions: state.sessions.map(s =>
        s.id === canonical.id
          ? { ...s, flowState: { ...s.flowState, nodes, edges, history: [], historyIndex: -1 } }
          : s
      ),
    }));
    sessionStore.saveSessions();
  }, [flowId]);

  const loadBranches = useCallback(async () => {
    if (!flowId) return;
    try {
      const data = await flowGitApi.branches(flowId) as any;
      setBranches(Array.isArray(data?.branches) ? data.branches : []);
      if (data?.active) setActiveBranch(data.active);
    } catch { /* branches are best-effort */ }
  }, [flowId]);

  const copyClone = useCallback(() => {
    if (!cloneUrl) return;
    navigator.clipboard?.writeText(cloneUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* clipboard blocked */ });
  }, [cloneUrl]);

  const load = useCallback(async () => {
    if (!flowId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await flowGitApi.versions(flowId) as any;
      setVersions(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, [flowId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadBranches(); }, [loadBranches]);

  const checkout = useCallback(async (branch: string) => {
    if (!flowId || branch === activeBranch) return;
    try {
      const updated: any = await flowGitApi.checkout(flowId, branch);
      applyToSession(Array.isArray(updated?.nodes) ? updated.nodes : [], Array.isArray(updated?.edges) ? updated.edges : []);
      setActiveBranch(branch);
      await loadAll();
      await load();
      await loadBranches();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to switch branch');
    }
  }, [flowId, activeBranch, applyToSession, loadAll, load, loadBranches]);

  // Create a new branch from the current active HEAD, then switch to it.
  const createBranch = useCallback(async () => {
    if (!flowId) return;
    const name = window.prompt('New branch name (from current HEAD):')?.trim();
    if (!name) return;
    try {
      const data: any = await flowGitApi.createBranch(flowId, name);
      if (Array.isArray(data?.branches)) setBranches(data.branches);
      await checkout(name);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create branch');
    }
  }, [flowId]);

  // Delete a branch (never main, never the active one). Asks for confirmation
  // and, if the deleted branch was selected, falls back to the active branch.
  const deleteBranch = useCallback(async (branch: string) => {
    if (!flowId) return;
    if (branch === 'main') { setError('The main branch cannot be deleted'); return; }
    if (branch === activeBranch) { setError('Check out another branch before deleting this one'); return; }
    if (!confirm(`Delete branch "${branch}"? This permanently removes it and any commits only it kept. This cannot be undone.`)) return;
    try {
      const data: any = await flowGitApi.deleteBranch(flowId, branch);
      if (Array.isArray(data?.branches)) setBranches(data.branches);
      else await loadBranches();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete branch');
    }
  }, [flowId, activeBranch, loadBranches]);

  // Rework the active branch around a commit.
  //   mode 'root' — make this commit the new root (drop older history).
  //   mode 'head' — reset the branch tip here (drop newer commits).
  // Both GC unreachable objects server-side. Irreversible.
  const reworkTo = useCallback(async (commit: string, mode: 'root' | 'head') => {
    if (!flowId) return;
    const msg = mode === 'root'
      ? `Make ${commit.slice(0, 8)} the new root of "${activeBranch}"?\nOlder commits are permanently deleted.`
      : `Reset "${activeBranch}" to ${commit.slice(0, 8)}?\nNewer commits are permanently deleted.`;
    if (!confirm(msg)) return;
    try {
      const data: any = await flowGitApi.reset(flowId, activeBranch, commit, mode);
      const f = data?.flow;
      if (f && (Array.isArray(f.nodes) || Array.isArray(f.edges))) {
        applyToSession(Array.isArray(f.nodes) ? f.nodes : [], Array.isArray(f.edges) ? f.edges : []);
      }
      setSelected(null);
      await loadAll();
      await load();
      await loadBranches();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to rework branch');
    }
  }, [flowId, activeBranch, applyToSession, loadAll, load, loadBranches]);

  // Poll every 10s while the panel is open so autosaves materialise without a
  // manual refresh.
  useEffect(() => {
    if (!flowId) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, flowId]);

  useEffect(() => {
    if (!selected || !flowId) { setDetail(null); return; }
    let cancelled = false;
    flowGitApi.version(flowId, selected).then((v: any) => {
      if (!cancelled) setDetail(v as VersionDetail);
    }).catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load version'); });
    return () => { cancelled = true; };
  }, [selected, flowId]);

  const restore = useCallback(async (vid: string) => {
    if (!flowId) return;
    if (!confirm('Restore this version? The current state is snapshotted first so this is reversible.')) return;
    try {
      // Restore on the server, then push the restored payload into both
      // the flow library AND the active editor session. Without the session
      // update the canvas would keep showing the pre-restore graph (the
      // editor reads from the session, not from flowLibraryStore) and the
      // autosave loop would PUT it right back, undoing the restore.
      const restored: any = await flowGitApi.restoreVersion(flowId, vid);
      const restoredNodes = Array.isArray(restored?.nodes) ? restored.nodes : [];
      const restoredEdges = Array.isArray(restored?.edges) ? restored.edges : [];
      const sessionStore = useSessionStore.getState();
      // Write into the canonical session (the library mirror), NOT whichever
      // session happens to be active — that could be a child flow-node editor,
      // and writing the restored flow graph into it would wipe its content.
      const canonical = sessionStore.getCanonicalSession(flowId);
      if (canonical) {
        useSessionStore.setState(state => ({
          sessions: state.sessions.map(s =>
            s.id === canonical.id
              ? { ...s, flowState: { ...s.flowState, nodes: restoredNodes, edges: restoredEdges, history: [], historyIndex: -1 } }
              : s
          ),
        }));
        sessionStore.saveSessions();
      }
      await loadAll();
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to restore version');
    }
  }, [flowId, loadAll, load]);

  const diff = detail && flow ? diffSnapshots({ nodes: detail.nodes, edges: detail.edges }, { nodes: flow.nodes, edges: flow.edges }) : null;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-2)', borderLeft: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <History size={13} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text)' }}>Version History</span>
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{versions.length}</span>
        <button
          onClick={load}
          className="ml-auto"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {error && (
        <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--err)' }}>{error}</div>
      )}

      {/* Git: branch switcher + clone URL */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GitBranch size={12} style={{ color: 'var(--accent)' }} />
          <select
            value={activeBranch}
            onChange={e => checkout(e.target.value)}
            title="Active branch (executor runs its HEAD)"
            style={{
              flex: 1, height: 24, fontSize: 11, fontFamily: 'var(--font-mono)',
              background: 'var(--bg-1)', color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '0 6px', cursor: 'pointer',
            }}
          >
            {(branches.length ? branches : [activeBranch]).map(b => (
              <option key={b} value={b}>{b}{b === activeBranch ? ' (active)' : ''}</option>
            ))}
          </select>
          <button onClick={createBranch} className="tc-btn ghost" style={{ height: 24, padding: '0 6px' }} title="Create branch from current HEAD">
            <Plus size={12} />
          </button>
          {(() => {
            // Deletable = everything except main and the checked-out branch.
            const deletable = (branches.length ? branches : [activeBranch]).filter(b => b !== 'main' && b !== activeBranch);
            const onDelete = () => {
              if (deletable.length === 0) { setError('No deletable branch — "main" and the active branch are protected'); return; }
              let target = deletable[0];
              if (deletable.length > 1) {
                const ans = window.prompt(`Branch to delete (one of: ${deletable.join(', ')}):`, '')?.trim();
                if (!ans) return;
                if (!deletable.includes(ans)) { setError(`"${ans}" is not a deletable branch`); return; }
                target = ans;
              }
              deleteBranch(target);
            };
            return (
              <button
                onClick={onDelete}
                disabled={deletable.length === 0}
                className="tc-btn ghost"
                style={{ height: 24, padding: '0 6px', opacity: deletable.length === 0 ? 0.4 : 1 }}
                title={deletable.length === 0 ? 'No deletable branch (main and the active branch are protected)' : 'Delete a branch (not main / not the active one)'}
              >
                <Trash2 size={12} />
              </button>
            );
          })()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            readOnly
            value={cloneUrl}
            onFocus={e => e.currentTarget.select()}
            title="git clone URL — user = your login, password = an API key"
            style={{
              flex: 1, height: 24, fontSize: 10, fontFamily: 'var(--font-mono)',
              background: 'var(--bg-1)', color: 'var(--text-2)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '0 6px',
            }}
          />
          <button onClick={copyClone} className="tc-btn ghost" style={{ height: 24, padding: '0 6px' }} title="Copy clone URL">
            {copied ? <Check size={12} style={{ color: 'var(--ok)' }} /> : <Copy size={12} />}
          </button>
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-3)' }}>auth: login + API key</div>
      </div>

      <div style={{ flex: '0 1 auto', overflow: 'auto', borderBottom: '1px solid var(--border)', maxHeight: '40%' }}>
        {loading && versions.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-3)' }}>Loading…</div>
        ) : versions.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-mute)', fontStyle: 'italic' }}>
            No versions yet. Edit the flow to start tracking history.
          </div>
        ) : (
          versions.map(v => {
            const isSelected = v._id === selected;
            return (
              <div
                key={v._id}
                onClick={() => setSelected(isSelected ? null : v._id)}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  background: isSelected ? 'var(--accent-soft)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--text-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isSelected ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span style={{ color: 'var(--text)' }}>{new Date(v.savedAt).toLocaleString()}</span>
                </div>
                <div style={{ marginLeft: 17, color: 'var(--text-2)', fontSize: 10 }}>
                  {v.message || '(no message)'}
                </div>
                <div style={{ marginLeft: 17, color: 'var(--text-3)', fontSize: 10 }}>
                  {v.author || 'unknown'} · <span style={{ fontFamily: 'var(--font-mono)' }}>{v._id.slice(0, 8)}</span>
                </div>
                {isSelected && (
                  <div style={{ marginLeft: 17, marginTop: 6, display: 'flex', gap: 6 }}>
                    <button
                      onClick={e => { e.stopPropagation(); setShowDiff(d => !d); }}
                      className="tc-btn ghost"
                      style={{ height: 22, padding: '0 8px', gap: 4, fontSize: 10 }}
                    >
                      <Diff size={10} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); restore(v._id); }}
                      className="tc-btn ghost"
                      style={{ height: 22, padding: '0 8px', gap: 4, fontSize: 10, color: 'var(--warn)' }}
                    >
                      <RotateCcw size={10} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); reworkTo(v._id, 'root'); }}
                      className="tc-btn ghost"
                      style={{ height: 22, padding: '0 8px', gap: 4, fontSize: 10, color: 'var(--err)' }}
                      title="Make this the new root commit (drop older history)"
                    >
                      <Scissors size={10} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); reworkTo(v._id, 'head'); }}
                      className="tc-btn ghost"
                      style={{ height: 22, padding: '0 8px', gap: 4, fontSize: 10, color: 'var(--err)' }}
                      title="Reset branch tip here (drop newer commits)"
                    >
                      <ArrowDownToLine size={10} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Diff against current draft */}
      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        {!selected ? (
          <div style={{ fontSize: 11, color: 'var(--text-mute)', fontStyle: 'italic' }}>
            Pick a version to diff it against the current draft.
          </div>
        ) : !detail || !diff ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Loading version…</div>
        ) : !showDiff ? null : (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <div style={{ color: 'var(--text-3)', marginBottom: 6 }}>
              diff: {new Date(detail.savedAt).toLocaleString()} → current draft
            </div>
            {diff.addedNodes.length === 0 && diff.removedNodes.length === 0 && diff.changedNodes.length === 0 && diff.addedEdges.length === 0 && diff.removedEdges.length === 0 ? (
              <div style={{ color: 'var(--ok)' }}>No graph differences.</div>
            ) : (
              <>
                {diff.addedNodes.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ color: 'var(--ok)' }}>+ Added nodes ({diff.addedNodes.length})</div>
                    {diff.addedNodes.map((n: any) => (
                      <div key={n.id} style={{ marginLeft: 10, color: 'var(--ok)' }}>+ {n?.data?.label || n.id} <span style={{ color: 'var(--text-3)' }}>[{n?.data?.type}]</span></div>
                    ))}
                  </div>
                )}
                {diff.removedNodes.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ color: 'var(--err)' }}>- Removed nodes ({diff.removedNodes.length})</div>
                    {diff.removedNodes.map((n: any) => (
                      <div key={n.id} style={{ marginLeft: 10, color: 'var(--err)' }}>- {n?.data?.label || n.id} <span style={{ color: 'var(--text-3)' }}>[{n?.data?.type}]</span></div>
                    ))}
                  </div>
                )}
                {diff.changedNodes.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ color: 'var(--warn)' }}>~ Changed nodes ({diff.changedNodes.length})</div>
                    {diff.changedNodes.map(c => (
                      <div key={c.id} style={{ marginLeft: 10, color: 'var(--warn)' }}>~ {c.label}</div>
                    ))}
                  </div>
                )}
                {diff.addedEdges.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ color: 'var(--ok)' }}>+ Added edges ({diff.addedEdges.length})</div>
                    {diff.addedEdges.slice(0, 30).map((e: any, i: number) => (
                      <div key={i} style={{ marginLeft: 10, color: 'var(--ok)' }}>+ {e.source} → {e.target}</div>
                    ))}
                  </div>
                )}
                {diff.removedEdges.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ color: 'var(--err)' }}>- Removed edges ({diff.removedEdges.length})</div>
                    {diff.removedEdges.slice(0, 30).map((e: any, i: number) => (
                      <div key={i} style={{ marginLeft: 10, color: 'var(--err)' }}>- {e.source} → {e.target}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VersionHistoryPanel;
