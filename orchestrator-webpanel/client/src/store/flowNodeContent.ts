import { Node, Edge } from 'reactflow';
import { useSessionStore } from './sessionStore';
import { useFlowLibraryStore } from './flowLibraryStore';

/**
 * Single home for everything about a `flow` node's reference to a sub-flow.
 *
 * A flow node points at a sub-flow through ONE of three mechanisms, in strict
 * precedence order:
 *   1. flowRef        — id of a persisted library flow (authoritative, live)
 *   2. linkedSessionId — id of a live editor session (client-only, live)
 *   3. code           — an embedded `{nodes,edges}` JSON snapshot (file import
 *                       or a detached node; also the snapshot the server falls
 *                       back to when it can't resolve a session)
 *
 * Previously this precedence was re-implemented (inconsistently) in the node
 * executor and three separate double-click handlers. Centralised here.
 */

export interface FlowNodeData {
  label: string;
  type: 'flow';
  code: string;
  flowRef?: string;
  linkedSessionId?: string;
  isRelativePath: boolean;
}

const serialize = (nodes?: Node[], edges?: Edge[]) =>
  JSON.stringify({ nodes: nodes || [], edges: edges || [] });

/**
 * Resolve the executable sub-flow definition (a `{nodes,edges}` JSON string)
 * for a flow node, applying the precedence above. Returns null when nothing
 * resolves.
 */
export function resolveFlowNodeContent(data: any): string | null {
  if (data?.flowRef) {
    const ref = useFlowLibraryStore.getState().flows.find(f => f.id === data.flowRef);
    if (ref) return serialize(ref.nodes, ref.edges);
    // flowRef set but library entry gone — fall through to any embedded copy.
  }
  if (data?.linkedSessionId) {
    const s = useSessionStore.getState().getSession(data.linkedSessionId);
    if (s) return serialize(s.flowState.nodes, s.flowState.edges);
  }
  return data?.code ? data.code : null;
}

/** Build the `data` payload for a flow node from whichever reference applies. */
export function buildFlowNodeData(opts: {
  label: string;
  flowRef?: string;
  linkedSessionId?: string;
  code?: string;
}): FlowNodeData {
  return {
    label: opts.label,
    type: 'flow',
    code: opts.code ?? '',
    isRelativePath: false,
    ...(opts.flowRef ? { flowRef: opts.flowRef } : {}),
    ...(opts.linkedSessionId ? { linkedSessionId: opts.linkedSessionId } : {}),
  };
}

/** Build a complete flow node (custom node wrapper + data). */
export function makeFlowNode(opts: {
  label: string;
  flowRef?: string;
  linkedSessionId?: string;
  code?: string;
  position?: { x: number; y: number };
}): Node {
  return {
    id: `node-${Date.now()}`,
    type: 'custom',
    position: opts.position || { x: 100, y: 100 },
    data: buildFlowNodeData(opts),
    draggable: true,
  };
}

export interface OpenFlowNodeResult {
  /** When set, the caller should navigate here (flowRef → library editor). */
  navigateTo?: string;
}

/**
 * Open the editor for a flow node:
 *   - flowRef        → ask caller to navigate to the library flow editor
 *   - linkedSessionId (existing) → switch to that session tab
 *   - otherwise      → create a new linked session hydrated from `code`, link
 *                      it back onto the node in the ORIGINAL session, switch.
 *
 * Consolidates the three near-identical copies that lived in FlowEditor,
 * CustomNode and NodeHeader (and fixes their drift: FlowEditor used to link the
 * node in the wrong session; CustomNode ignored flowRef entirely).
 */
export async function openFlowNodeEditor(
  node: { id: string; data: any },
  currentSessionId: string | null,
): Promise<OpenFlowNodeResult> {
  const data = node.data || {};

  if (data.flowRef) {
    return { navigateTo: `/flows/${data.flowRef}?tab=edit` };
  }

  const store = useSessionStore.getState();

  // Existing linked session → just focus it.
  if (data.linkedSessionId && store.getSession(data.linkedSessionId)) {
    store.switchSession(data.linkedSessionId);
    return {};
  }

  // No (live) link — create a session hydrated from the embedded snapshot.
  const sessionName = data.label || 'Flow Session';
  const parentFlowId = store.getActiveSession()?.linkedFlowId;
  const originalSessionId = currentSessionId ?? store.activeSessionId;
  const newSessionId = await store.createSession(sessionName, parentFlowId); // switches active

  let parsed: { nodes: Node[]; edges: Edge[] } | null = null;
  if (typeof data.code === 'string' && data.code.trim()) {
    try {
      const fd = JSON.parse(data.code);
      if (Array.isArray(fd.nodes) && Array.isArray(fd.edges)) parsed = fd;
    } catch (e) {
      console.error('Failed to parse flow content:', e);
    }
  }

  store.updateActiveFlowState({
    nodes: (parsed?.nodes || []).map(n => ({
      ...n,
      data: { ...n.data, output: undefined, executionTime: undefined },
    })),
    edges: parsed?.edges || [],
    flowPath: `${sessionName}.or`,
    history: [],
    historyIndex: -1,
  });

  // Link the node back in the ORIGINAL session (not the freshly-switched one).
  if (originalSessionId) {
    useSessionStore.setState(state => ({
      sessions: state.sessions.map(s =>
        s.id === originalSessionId
          ? {
              ...s,
              flowState: {
                ...s.flowState,
                nodes: s.flowState.nodes.map(n =>
                  n.id === node.id ? { ...n, data: { ...n.data, linkedSessionId: newSessionId } } : n,
                ),
              },
            }
          : s,
      ),
    }));
    store.saveSessions();
  }

  return {};
}
