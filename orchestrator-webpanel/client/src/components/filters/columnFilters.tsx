import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ListFilter, X, Search, Check } from 'lucide-react';

/* ──────────────────────────────────────────────────────────────────────────
   Column filters — one small system shared by every executions table.

   A column declares how it filters:
     facet     pick among the values actually present (with live counts)
     text      "contains" search
     time      recency presets (last hour / 24h / 7d / 30d)
     duration  range presets (<1s, 1–10s, 10s–1m, >1m)

   Facet counts are "smart": each column counts rows that pass every OTHER
   active filter, so the numbers always say what you would get by ticking.
   ────────────────────────────────────────────────────────────────────────── */

export type FilterKind = 'facet' | 'text' | 'time' | 'duration';

export interface FilterColumn<T> {
  key: string;
  label: string;
  kind: FilterKind;
  /** Raw value used for matching. For facets this is the facet key. */
  value: (row: T) => string | number | null | undefined;
  /** Facet only: how a key is shown in the list and in chips. */
  display?: (key: string, row?: T) => string;
}

export type FilterValue =
  | { kind: 'facet'; values: string[] }
  | { kind: 'text'; q: string }
  | { kind: 'time'; preset: TimePreset }
  | { kind: 'duration'; preset: DurationPreset };

export type Filters = Record<string, FilterValue | undefined>;

export type TimePreset = '1h' | '24h' | '7d' | '30d';
export type DurationPreset = 'lt1s' | '1to10s' | '10to60s' | 'gt1m';

const TIME_PRESETS: { id: TimePreset; label: string; ms: number }[] = [
  { id: '1h', label: 'Last hour', ms: 3600e3 },
  { id: '24h', label: 'Last 24 hours', ms: 86400e3 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 86400e3 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 86400e3 },
];
const DURATION_PRESETS: { id: DurationPreset; label: string; test: (ms: number) => boolean }[] = [
  { id: 'lt1s', label: 'Under 1s', test: ms => ms < 1000 },
  { id: '1to10s', label: '1s – 10s', test: ms => ms >= 1000 && ms < 10000 },
  { id: '10to60s', label: '10s – 1m', test: ms => ms >= 10000 && ms < 60000 },
  { id: 'gt1m', label: 'Over 1m', test: ms => ms >= 60000 },
];

export const EMPTY = '∅';

function facetKey(v: unknown): string {
  return v === null || v === undefined || v === '' ? EMPTY : String(v);
}

export function isActive(f: FilterValue | undefined): boolean {
  if (!f) return false;
  if (f.kind === 'facet') return f.values.length > 0;
  if (f.kind === 'text') return f.q.trim() !== '';
  return true;
}

function matches<T>(row: T, col: FilterColumn<T>, f: FilterValue): boolean {
  const raw = col.value(row);
  switch (f.kind) {
    case 'facet': return f.values.includes(facetKey(raw));
    case 'text': return String(raw ?? '').toLowerCase().includes(f.q.trim().toLowerCase());
    case 'time': {
      const t = typeof raw === 'number' ? raw : new Date(String(raw ?? '')).getTime();
      const p = TIME_PRESETS.find(x => x.id === f.preset);
      return !isNaN(t) && !!p && Date.now() - t <= p.ms;
    }
    case 'duration': {
      const ms = typeof raw === 'number' ? raw : NaN;
      const p = DURATION_PRESETS.find(x => x.id === f.preset);
      return !isNaN(ms) && !!p && p.test(ms);
    }
  }
}

export function applyFilters<T>(rows: T[], cols: FilterColumn<T>[], filters: Filters, exceptKey?: string): T[] {
  const active = cols.filter(c => c.key !== exceptKey && isActive(filters[c.key]));
  if (!active.length) return rows;
  return rows.filter(r => active.every(c => matches(r, c, filters[c.key]!)));
}

export function describeFilter<T>(col: FilterColumn<T>, f: FilterValue): string {
  switch (f.kind) {
    case 'facet': {
      const names = f.values.map(v => (v === EMPTY ? 'none' : col.display ? col.display(v) : v));
      return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
    }
    case 'text': return `“${f.q.trim()}”`;
    case 'time': return TIME_PRESETS.find(p => p.id === f.preset)?.label.toLowerCase() ?? '';
    case 'duration': return DURATION_PRESETS.find(p => p.id === f.preset)?.label ?? '';
  }
}

/** Filter state, optionally remembered per table in localStorage. */
export function useFilters(storageKey?: string) {
  const [filters, setFilters] = useState<Filters>(() => {
    if (!storageKey) return {};
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { return {}; }
  });
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(filters)); } catch { /* storage unavailable */ }
  }, [filters, storageKey]);
  const setFilter = (key: string, f: FilterValue | undefined) =>
    setFilters(prev => {
      const next = { ...prev };
      if (f && isActive(f)) next[key] = f; else delete next[key];
      return next;
    });
  return { filters, setFilter, clearAll: () => setFilters({}) };
}

/* ── Popover ────────────────────────────────────────────────────────────── */

interface PopoverProps<T> {
  col: FilterColumn<T>;
  rows: T[];               // rows BEFORE filtering (counts use the other filters)
  cols: FilterColumn<T>[];
  filters: Filters;
  onChange: (f: FilterValue | undefined) => void;
  anchor: HTMLElement;
  onClose: () => void;
}

function FilterPopover<T>({ col, rows, cols, filters, onChange, anchor, onClose }: PopoverProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  const [q, setQ] = useState('');
  const current = filters[col.key];

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 260;
    const h = ref.current?.offsetHeight ?? 300;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.focus(); } };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  // Facet values present in the rows that pass every other filter.
  const facets = useMemo(() => {
    if (col.kind !== 'facet') return [];
    const base = applyFilters(rows, cols, filters, col.key);
    const counts = new Map<string, { n: number; row: T }>();
    for (const r of base) {
      const k = facetKey(col.value(r));
      const e = counts.get(k);
      if (e) e.n++; else counts.set(k, { n: 1, row: r });
    }
    // keep selected values visible even when the other filters hide them
    if (current?.kind === 'facet') for (const v of current.values) if (!counts.has(v)) counts.set(v, { n: 0, row: undefined as any });
    return [...counts.entries()]
      .map(([key, { n, row }]) => ({ key, n, label: key === EMPTY ? 'none' : col.display ? col.display(key, row) : key }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }, [col, rows, cols, filters, current]);

  const selected = current?.kind === 'facet' ? current.values : [];
  const toggle = (k: string) => {
    const next = selected.includes(k) ? selected.filter(v => v !== k) : [...selected, k];
    onChange(next.length ? { kind: 'facet', values: next } : undefined);
  };
  const shown = q ? facets.filter(f => f.label.toLowerCase().includes(q.toLowerCase())) : facets;

  return createPortal(
    <div
      ref={ref}
      className="tc-filter-pop"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={`Filter ${col.label}`}
    >
      <div className="tc-filter-pop-head">
        <span>Filter by {col.label.toLowerCase()}</span>
        {isActive(current) && (
          <button type="button" className="tc-filter-link" onClick={() => onChange(undefined)}>Clear</button>
        )}
      </div>

      {col.kind === 'facet' && (
        <>
          {facets.length > 6 && (
            <label className="tc-filter-search">
              <Search size={12} />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${col.label.toLowerCase()}…`} />
            </label>
          )}
          <ul className="tc-filter-list" role="listbox" aria-multiselectable="true">
            {shown.length === 0 && <li className="tc-filter-empty">No values</li>}
            {shown.map((f, i) => {
              const on = selected.includes(f.key);
              return (
                <li key={f.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    autoFocus={facets.length <= 6 && i === 0}
                    className={`tc-filter-opt${on ? ' on' : ''}${f.n === 0 ? ' zero' : ''}`}
                    onClick={() => toggle(f.key)}
                  >
                    <span className="box">{on && <Check size={11} strokeWidth={3} />}</span>
                    <span className={`lbl${f.key === EMPTY ? ' none' : ''}`}>{f.label}</span>
                    <span className="n">{f.n}</span>
                  </button>
                  <button
                    type="button"
                    className="tc-filter-only"
                    onClick={() => onChange({ kind: 'facet', values: [f.key] })}
                    title={`Show only ${f.label}`}
                  >
                    only
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {col.kind === 'text' && (
        <label className="tc-filter-search">
          <Search size={12} />
          <input
            autoFocus
            value={current?.kind === 'text' ? current.q : ''}
            onChange={e => onChange(e.target.value ? { kind: 'text', q: e.target.value } : undefined)}
            onKeyDown={e => { if (e.key === 'Enter') onClose(); }}
            placeholder="Contains…"
          />
        </label>
      )}

      {(col.kind === 'time' || col.kind === 'duration') && (
        <ul className="tc-filter-list" role="listbox">
          {(col.kind === 'time' ? TIME_PRESETS : DURATION_PRESETS).map((p, i) => {
            const on = current && 'preset' in current && current.preset === p.id;
            const count = applyFilters(applyFilters(rows, cols, filters, col.key), [col],
              { [col.key]: col.kind === 'time' ? { kind: 'time', preset: p.id as TimePreset } : { kind: 'duration', preset: p.id as DurationPreset } }).length;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={!!on}
                  autoFocus={i === 0}
                  className={`tc-filter-opt radio${on ? ' on' : ''}${count === 0 ? ' zero' : ''}`}
                  onClick={() => onChange(on ? undefined : (col.kind === 'time'
                    ? { kind: 'time', preset: p.id as TimePreset }
                    : { kind: 'duration', preset: p.id as DurationPreset }))}
                >
                  <span className="box" />
                  <span className="lbl">{p.label}</span>
                  <span className="n">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
}

/* ── Triggers: header button and pill ───────────────────────────────────── */

interface TriggerProps<T> {
  col: FilterColumn<T>;
  rows: T[];
  cols: FilterColumn<T>[];
  filters: Filters;
  setFilter: (key: string, f: FilterValue | undefined) => void;
}

/** Column header label + filter button. Put inside a <th>. */
export function FilterHeader<T>({ col, rows, cols, filters, setFilter }: TriggerProps<T>) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const active = isActive(filters[col.key]);
  return (
    <span className="tc-filter-th">
      {col.label}
      <button
        type="button"
        className={`tc-filter-btn${active ? ' active' : ''}${anchor ? ' open' : ''}`}
        onClick={e => { e.stopPropagation(); setAnchor(a => (a ? null : e.currentTarget)); }}
        aria-label={`Filter ${col.label}${active ? ' (active)' : ''}`}
        aria-expanded={!!anchor}
        title={active ? `Filtered: ${describeFilter(col, filters[col.key]!)}` : `Filter ${col.label.toLowerCase()}`}
      >
        <ListFilter size={12} />
      </button>
      {anchor && (
        <FilterPopover col={col} rows={rows} cols={cols} filters={filters}
          onChange={f => setFilter(col.key, f)} anchor={anchor} onClose={() => setAnchor(null)} />
      )}
    </span>
  );
}

/** Compact pill for list layouts without column headers. */
export function FilterPill<T>({ col, rows, cols, filters, setFilter }: TriggerProps<T>) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const f = filters[col.key];
  const active = isActive(f);
  return (
    <>
      <button
        type="button"
        className={`tc-filter-pill${active ? ' active' : ''}`}
        onClick={e => setAnchor(a => (a ? null : e.currentTarget))}
        aria-expanded={!!anchor}
      >
        <span>{col.label}</span>
        {active && <span className="val">{describeFilter(col, f!)}</span>}
      </button>
      {anchor && (
        <FilterPopover col={col} rows={rows} cols={cols} filters={filters}
          onChange={nf => setFilter(col.key, nf)} anchor={anchor} onClose={() => setAnchor(null)} />
      )}
    </>
  );
}

/** Removable chips for every active filter, plus "Clear all". */
export function ActiveFilters<T>({ cols, filters, setFilter, clearAll, total, shown }: {
  cols: FilterColumn<T>[]; filters: Filters;
  setFilter: (key: string, f: FilterValue | undefined) => void; clearAll: () => void;
  total: number; shown: number;
}) {
  const active = cols.filter(c => isActive(filters[c.key]));
  if (!active.length) return null;
  return (
    <div className="tc-filter-chips" aria-label="Active filters">
      <span className="count">{shown} of {total}</span>
      {active.map(c => (
        <span key={c.key} className="tc-filter-chip">
          <span className="k">{c.label}</span>
          <span className="v">{describeFilter(c, filters[c.key]!)}</span>
          <button type="button" onClick={() => setFilter(c.key, undefined)} aria-label={`Remove ${c.label} filter`}>
            <X size={11} />
          </button>
        </span>
      ))}
      <button type="button" className="tc-filter-link" onClick={clearAll}>Clear all</button>
    </div>
  );
}

/* ── Execution columns (shared by the three executions views) ───────────── */

export interface ExecLike {
  id: string;
  displayName?: string;
  flowId: string;
  flowName: string;
  namespace: string;
  status: string;
  workerName?: string;
  branch?: string;
  triggeredBy: string;
  triggeredUser?: string | null;
  startTime: string;
  duration: number | null;
}

export function executionColumns<T extends ExecLike>(): Record<string, FilterColumn<T>> {
  return {
    id: { key: 'id', label: 'Execution', kind: 'text', value: e => `${e.id} ${e.displayName ?? ''}` },
    flow: {
      key: 'flow', label: 'Flow', kind: 'facet', value: e => e.flowId,
      display: (k, r) => (r ? `${r.flowName} · ${r.namespace}` : k),
    },
    status: { key: 'status', label: 'Status', kind: 'facet', value: e => e.status, display: k => k.charAt(0) + k.slice(1).toLowerCase() },
    worker: { key: 'worker', label: 'Worker', kind: 'facet', value: e => e.workerName || 'server' },
    branch: { key: 'branch', label: 'Branch', kind: 'facet', value: e => e.branch },
    trigger: { key: 'trigger', label: 'Trigger', kind: 'facet', value: e => e.triggeredBy },
    by: { key: 'by', label: 'By', kind: 'facet', value: e => e.triggeredUser },
    started: { key: 'started', label: 'Started', kind: 'time', value: e => e.startTime },
    duration: { key: 'duration', label: 'Duration', kind: 'duration', value: e => e.duration },
  };
}

/** True when the "by" value is an IP address rather than a login. */
export function looksLikeIp(v: string | null | undefined): boolean {
  return !!v && (/^\d{1,3}(\.\d{1,3}){3}$/.test(v) || /^[0-9a-f:]+$/i.test(v) && v.includes(':'));
}
