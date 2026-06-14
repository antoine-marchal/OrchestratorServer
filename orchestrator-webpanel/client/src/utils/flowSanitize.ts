// Sanitizers shared by every path that fingerprints a flow graph or persists it
// to the server / git.
//
// React Flow tags nodes/edges with transient UI state — selection, drag,
// measured size — that is NOT graph content. Selecting or dragging-highlighting
// a node must not count as an edit, otherwise autosave fires (and even persists
// `selected: true`) on every click. Strip it everywhere we fingerprint or save.
//
// Because normContent() fingerprints through this same strip, any field removed
// here is ALSO excluded from the "did something important change?" check — so a
// change to it never triggers an autosave/commit. These fields stay in the
// session's localStorage (full nodes are persisted there), so the canvas keeps
// them across reloads; they just never reach the DB or the git history:
//   top-level: selected, dragging, resizing, positionAbsolute, width, height, draggable
//   data:      executionStatus, executionAttempt, output (a node's run result), executionTime
const stripNode = (n: any) => {
  const { selected, dragging, resizing, positionAbsolute, width, height, draggable, ...rest } = n;
  return {
    ...rest,
    data: {
      ...n.data,
      executionStatus: undefined,
      executionAttempt: undefined,
      output: undefined,
      executionTime: undefined,
    },
  };
};

const stripEdge = (e: any) => {
  const { selected, ...rest } = e;
  return rest;
};

export const sanitizeNodesForSave = (nodes: any[]): any[] => (nodes || []).map(stripNode);
export const sanitizeEdgesForSave = (edges: any[]): any[] => (edges || []).map(stripEdge);

// Stable string fingerprint of a graph, ignoring transient run overlays + UI
// state, so we can tell whether the editor session matches the server def.
export const normContent = (nodes: any[], edges: any[]): string =>
  JSON.stringify({ nodes: sanitizeNodesForSave(nodes), edges: sanitizeEdgesForSave(edges) });
