/**
 * Node-instance scoping.
 *
 * A node inside a reusable subflow has the SAME `nodeId` no matter which parent
 * flow node invoked it. When a flow does `[A, B] -> C` and both A and B point at
 * a subflow F containing node F1, F1 executes twice but shares one id. To keep
 * `A.F1` and `B.F1` distinct in the node tree, timeline, graph and logs we tag
 * every emitted log/status with a `parentScope`: the SEP-joined chain of
 * ancestor flow-node ids. The full instance key is `parentScope + SEP + nodeId`.
 *
 * Must match the server constant (nodeExecutor.ts `NODE_SCOPE_SEP`).
 */
export const NODE_SCOPE_SEP = '\u001f';

/** Full identity of a node instance = ancestor chain + own id. */
export function scopeKey(parentScope: string | null | undefined, nodeId: string): string {
  return parentScope ? `${parentScope}${NODE_SCOPE_SEP}${nodeId}` : nodeId;
}

/** The instance key for a log entry (or anything carrying parentScope + nodeId). */
export function scopeKeyOf(entry: { nodeId?: string | null; parentScope?: string | null }): string {
  return scopeKey(entry.parentScope, entry.nodeId || '');
}

/** Append a flow node to a scope, yielding the scope of its inner sub-graph. */
export function childScope(parentScope: string | null | undefined, flowNodeId: string): string {
  return scopeKey(parentScope, flowNodeId);
}

/** Last segment (own node id) of a scope key. */
export function nodeIdOfScope(key: string): string {
  const i = key.lastIndexOf(NODE_SCOPE_SEP);
  return i < 0 ? key : key.slice(i + NODE_SCOPE_SEP.length);
}

/**
 * True when `key` is `sel` itself or a descendant of it â€” i.e. selecting a flow
 * node should surface logs from every node inside its sub-graph.
 */
export function scopeMatchesOrDescends(key: string, sel: string): boolean {
  return key === sel || key.startsWith(sel + NODE_SCOPE_SEP);
}
