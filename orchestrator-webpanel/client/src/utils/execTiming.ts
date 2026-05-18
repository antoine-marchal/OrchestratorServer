import type { LogEntry } from '../types/flows';

export interface NodeTiming {
  start: number;   // ms epoch — first log seen for the node
  end: number;     // ms epoch — last log seen for the node
  hasError: boolean;
}

/** Derive per-node start/end timestamps from a flat log stream (collapsed across all runs). */
export function computeNodeTimings(logs: LogEntry[]): Map<string, NodeTiming> {
  const m = new Map<string, NodeTiming>();
  for (const l of logs) {
    if (!l.nodeId) continue;
    if (l.type === 'flow') continue; // marker — not part of node timing
    const cur = m.get(l.nodeId);
    if (!cur) {
      m.set(l.nodeId, { start: l.timestamp, end: l.timestamp, hasError: l.type === 'error' });
    } else {
      if (l.timestamp < cur.start) cur.start = l.timestamp;
      if (l.timestamp > cur.end) cur.end = l.timestamp;
      if (l.type === 'error') cur.hasError = true;
    }
  }
  return m;
}

export interface NodeRun {
  start: number;
  end: number;
  hasError: boolean;
}

/**
 * Split each node's logs into distinct runs. A new run is opened on every
 * `input`-typed log for that node (covers retries and goto loops where a node
 * executes more than once). Nodes that never emit an `input` get a single run.
 */
export function computeNodeRuns(logs: LogEntry[]): Map<string, NodeRun[]> {
  const sorted = [...logs].sort((a, b) => a.timestamp - b.timestamp);
  const runs = new Map<string, NodeRun[]>();
  const open = new Map<string, NodeRun>();

  const closeRun = (id: string) => {
    const r = open.get(id);
    if (r) {
      if (!runs.has(id)) runs.set(id, []);
      runs.get(id)!.push(r);
      open.delete(id);
    }
  };

  for (const l of sorted) {
    const id = l.nodeId;
    if (!id) continue;
    // Skip `flow` marker entries entirely: they're emitted *before* the
    // `input` log for flow-type nodes and would otherwise count as a phantom
    // run-opening event, making every executed flow node show up as ×2.
    if (l.type === 'flow') continue;
    if (l.type === 'input') {
      closeRun(id);
      open.set(id, { start: l.timestamp, end: l.timestamp, hasError: false });
    } else {
      let r = open.get(id);
      if (!r) { r = { start: l.timestamp, end: l.timestamp, hasError: false }; open.set(id, r); }
      r.end = l.timestamp;
      if (l.type === 'error') r.hasError = true;
    }
  }
  for (const id of [...open.keys()]) closeRun(id);
  return runs;
}

/**
 * Per-node duration (ms) of the LAST run — what the execution graph badge shows.
 * Falls back to collapsed span when no run could be derived.
 */
export function lastNodeDurations(logs: LogEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  const runs = computeNodeRuns(logs);
  for (const [id, list] of runs) {
    const last = list[list.length - 1];
    out[id] = Math.max(0, last.end - last.start);
  }
  return out;
}

/** Duration in ms for a node id (collapsed span), or null if it never logged. */
export function nodeDurationMs(logs: LogEntry[], nodeId: string): number | null {
  const t = computeNodeTimings(logs).get(nodeId);
  return t ? Math.max(0, t.end - t.start) : null;
}

export function formatDurationShort(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '–';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s ? ` ${s}s` : ''}`;
}
