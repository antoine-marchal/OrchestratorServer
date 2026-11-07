import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw, RotateCcw, ArrowRight, CheckCircle2, Plus } from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { executionsApi } from '../../api';
import { useAuth } from '../../hooks/useAuth';
import { useServerWorkers, canUseWorker } from '../../hooks/useServerWorkers';
import StatusBadge from '../flows/StatusBadge';
import ExecIdCell from '../flows/ExecIdCell';
import type { ExecutionStatus, FlowExecution, OrchestratorFlow } from '../../types/flows';

/* ── Formatting ─────────────────────────────────────────────────────────── */

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return '—';
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const nf = new Intl.NumberFormat();

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const execLink = (e: { flowId: string; id: string }) => `/flows/${e.flowId}?tab=executions&exec=${e.id}`;

/* ── Stats window ───────────────────────────────────────────────────────── */

type WindowKey = '24h' | '7d' | '30d';
const WINDOWS: Record<WindowKey, { ms: number; buckets: number; label: string }> = {
  '24h': { ms: 86400000, buckets: 24, label: 'last 24 hours' },
  '7d': { ms: 7 * 86400000, buckets: 7, label: 'last 7 days' },
  '30d': { ms: 30 * 86400000, buckets: 30, label: 'last 30 days' },
};
const WINDOW_KEY_STORAGE = 'orchestrator_home_window';
const SAMPLE_LIMIT = 500;

interface Bucket { start: number; total: number; ok: number; failed: number; durations: number[] }
interface WindowStats {
  total: number;
  success: number;
  failed: number;
  medianMs: number | null;
  buckets: Bucket[];
  sampled: boolean;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function readWindowKey(): WindowKey {
  try {
    const v = localStorage.getItem(WINDOW_KEY_STORAGE);
    if (v === '24h' || v === '7d' || v === '30d') return v;
  } catch { /* storage unavailable */ }
  return '7d';
}

/* ── Small pieces ───────────────────────────────────────────────────────── */

const TICK_CLASS: Record<ExecutionStatus, string> = {
  SUCCESS: 'ok', FAILED: 'err', KILLED: 'warn', RUNNING: 'run', QUEUED: 'idle',
};

const RunTicks: React.FC<{ runs: FlowExecution[] }> = ({ runs }) => (
  <span className="tc-home-ticks" aria-label={`last ${runs.length} runs`}>
    {runs.map(r => (
      <span
        key={r.id}
        className={`tick ${TICK_CLASS[r.status] ?? 'idle'}`}
        title={`${r.status.toLowerCase()} · ${new Date(r.startTime).toLocaleString()}`}
      />
    ))}
  </span>
);

const Bars: React.FC<{ buckets: Bucket[]; pick: (b: Bucket) => number; max: number; tone: 'accent' | 'ok' | 'err' | 'mute'; title: (b: Bucket) => string }> =
  ({ buckets, pick, max, tone, title }) => (
    <div className={`tc-home-bars ${tone}`}>
      {buckets.map(b => {
        const v = pick(b);
        return (
          <span key={b.start} title={title(b)}>
            <i style={{ height: `${max > 0 ? Math.max(v > 0 ? 8 : 0, (v / max) * 100) : 0}%` }} />
          </span>
        );
      })}
    </div>
  );

/* ── Dashboard ──────────────────────────────────────────────────────────── */

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { flows, executions, loaded, loadAll, syncBackendExecutions, executeFlow } = useFlowLibraryStore();
  const { login, role, canEdit } = useAuth();
  const { workers, loading: workersLoading } = useServerWorkers(15_000);

  const [windowKey, setWindowKey] = useState<WindowKey>(readWindowKey);
  const [stats, setStats] = useState<WindowStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [failed24h, setFailed24h] = useState<FlowExecution[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const me = (login || '').toLowerCase();
  const flowById = useMemo(() => new Map(flows.map(f => [f.id, f])), [flows]);
  const isMine = useCallback((e: { flowId: string; triggeredUser?: string | null }) =>
    !!me && ((e.triggeredUser || '').toLowerCase() === me || (flowById.get(e.flowId)?.owner || '').toLowerCase() === me),
  [me, flowById]);

  // Live store: executions + flows every 5s (same cadence as the Flows page).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try { await syncBackendExecutions(); } catch { /* network blip */ }
      try { loadAll(); } catch { /* same */ }
    };
    tick();
    const t = setInterval(tick, 5000);
    const clock = setInterval(() => setTick(n => n + 1), 15000);
    return () => { cancelled = true; clearInterval(t); clearInterval(clock); };
  }, [syncBackendExecutions, loadAll]);

  // Window stats + 24h failures straight from the API (exact counts, not the
  // 100-row client cache).
  const loadStats = useCallback(async () => {
    const win = WINDOWS[windowKey];
    const now = Date.now();
    const since = encodeURIComponent(new Date(now - win.ms).toISOString());
    const since24 = encodeURIComponent(new Date(now - 86400000).toISOString());
    try {
      const [sample, ok, ko, fails]: any[] = await Promise.all([
        executionsApi.list(`?since=${since}&limit=${SAMPLE_LIMIT}`),
        executionsApi.list(`?since=${since}&status=SUCCESS&limit=1`),
        executionsApi.list(`?since=${since}&status=FAILED&limit=1`),
        executionsApi.list(`?since=${since24}&status=FAILED&limit=50`),
      ]);
      const rows: any[] = sample?.executions || [];
      const span = win.ms / win.buckets;
      const start0 = now - win.ms;
      const buckets: Bucket[] = Array.from({ length: win.buckets }, (_, i) => ({
        start: start0 + i * span, total: 0, ok: 0, failed: 0, durations: [],
      }));
      const durations: number[] = [];
      for (const r of rows) {
        const t = new Date(r.startTime).getTime();
        if (isNaN(t)) continue;
        const idx = Math.min(win.buckets - 1, Math.max(0, Math.floor((t - start0) / span)));
        const b = buckets[idx];
        b.total++;
        if (r.status === 'SUCCESS') b.ok++;
        if (r.status === 'FAILED') b.failed++;
        if (typeof r.duration === 'number' && r.status !== 'RUNNING') { b.durations.push(r.duration); durations.push(r.duration); }
      }
      setStats({
        total: sample?.total ?? rows.length,
        success: ok?.total ?? 0,
        failed: ko?.total ?? 0,
        medianMs: median(durations),
        buckets,
        sampled: (sample?.total ?? 0) > rows.length,
      });
      setFailed24h((fails?.executions || []).map((e: any) => ({
        id: e._id || e.id, flowId: e.flowId, flowName: e.flowName || '', namespace: e.namespace || 'default',
        workerId: e.workerId || '', workerName: e.workerName || '', branch: e.branch || undefined,
        jobId: e.jobId || '', status: e.status, triggeredBy: e.triggeredBy || 'manual',
        triggeredUser: e.triggeredUser || undefined, startTime: e.startTime, endTime: e.endTime ?? null,
        duration: e.duration ?? null, logs: [], output: null, error: e.error ?? null,
      } as FlowExecution)));
      setStatsError(null);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Could not load statistics');
    }
  }, [windowKey]);

  useEffect(() => {
    loadStats();
    const t = setInterval(loadStats, 30000);
    return () => clearInterval(t);
  }, [loadStats]);

  const chooseWindow = (k: WindowKey) => {
    setWindowKey(k);
    try { localStorage.setItem(WINDOW_KEY_STORAGE, k); } catch { /* ignore */ }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await Promise.all([syncBackendExecutions(), loadStats()]); loadAll(); }
    finally { setRefreshing(false); }
  };

  const canRunExec = (e: { workerId?: string }) => {
    if (!canEdit) return false;
    if (!e.workerId) return true;
    const w = workers.find(sw => sw._id === e.workerId);
    return !!w && canUseWorker(w, role, login);
  };

  const handleRerun = async (e: FlowExecution) => {
    setRerunningId(e.id);
    try {
      const execId = await executeFlow(e.flowId, 'manual', { workerId: e.workerId || '', branch: e.branch });
      navigate(`/flows/${e.flowId}?tab=executions&exec=${execId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRerunningId(null);
    }
  };

  /* ── Derived ── */

  const sortedExecs = useMemo(
    () => [...executions].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [executions],
  );
  const running = useMemo(() => {
    const r = sortedExecs.filter(e => e.status === 'RUNNING' || e.status === 'QUEUED');
    return [...r.filter(isMine), ...r.filter(e => !isMine(e))];
  }, [sortedExecs, isMine]);

  const failedMine = (failed24h || []).filter(isMine);
  const failedScopeMine = failedMine.length > 0 || !failed24h?.length;
  const failedShown = failedScopeMine ? failedMine : (failed24h || []);

  const onlineWorkers = workers.filter(w => w.status === 'online');
  const offlineWorkers = workers.filter(w => w.status !== 'online');

  const myExecs = sortedExecs.filter(isMine);
  const execsMineScope = myExecs.length > 0;
  const recentExecs = (execsMineScope ? myExecs : sortedExecs).slice(0, 8);

  const runsByFlow = useMemo(() => {
    const m = new Map<string, FlowExecution[]>();
    for (const e of sortedExecs) {
      const arr = m.get(e.flowId) || [];
      if (arr.length < 12) arr.push(e);
      m.set(e.flowId, arr);
    }
    return m;
  }, [sortedExecs]);

  const myFlows = useMemo(() => {
    const ranMine = new Set(myExecs.map(e => e.flowId));
    const lastActivity = (f: OrchestratorFlow) => {
      const t = runsByFlow.get(f.id)?.[0]?.startTime || f.lastExecution?.startTime || f.updatedAt;
      return t ? new Date(t).getTime() : 0;
    };
    const mine = flows.filter(f => (f.owner || '').toLowerCase() === me || ranMine.has(f.id));
    return { scopeMine: mine.length > 0, list: (mine.length ? mine : flows).slice().sort((a, b) => lastActivity(b) - lastActivity(a)).slice(0, 8) };
  }, [flows, me, myExecs, runsByFlow]);

  const ownedCount = flows.filter(f => (f.owner || '').toLowerCase() === me).length;
  const finished = stats ? stats.success + stats.failed : 0;
  const successRate = stats && finished > 0 ? (stats.success / finished) * 100 : null;
  const needsAttention = failedShown.length > 0 || offlineWorkers.length > 0;

  const subtitle = (() => {
    const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    if (failedMine.length) return `${today} · ${failedMine.length} of your run${failedMine.length > 1 ? 's' : ''} failed in the last 24h`;
    if (failed24h && failed24h.length) return `${today} · nothing of yours failed — ${failed24h.length} failure${failed24h.length > 1 ? 's' : ''} elsewhere in 24h`;
    if (failed24h) return `${today} · no failures in the last 24h`;
    return today;
  })();

  const maxBucket = stats ? Math.max(1, ...stats.buckets.map(b => b.total)) : 1;
  const bucketLabel = (b: Bucket) => windowKey === '24h'
    ? new Date(b.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date(b.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="tc-page tc-home">
      {/* Header */}
      <div className="tc-page-header">
        <div className="tc-page-title">
          <h1>
            <span className="br">&lt;</span>
            <span className="name">{greeting()}{login ? `, ${login}` : ''}</span>
            <span className="slash"> /&gt;</span>
          </h1>
          <span className="subtitle">{subtitle}</span>
        </div>
        <div className="tc-toolbar">
          {canEdit && (
            <Link to="/flows" className="tc-btn ghost"><Plus size={13} />New flow</Link>
          )}
          <button className="tc-btn ghost" onClick={handleRefresh} disabled={refreshing} title="Refresh" aria-label="Refresh dashboard">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Needs attention */}
      <section className={`tc-home-attn${needsAttention ? ' alert' : ''}`} aria-label="Needs attention">
        <div className="cell">
          <div className="cap">
            {failedScopeMine ? 'failed · yours · 24h' : 'failed · all flows · 24h'}
          </div>
          <div className={`big ${failedShown.length ? 'err' : 'ok'}`}>
            {failed24h === null ? '—' : failedShown.length}
          </div>
          {failed24h !== null && failedShown.length === 0 && (
            <div className="calm"><CheckCircle2 size={13} />All clear{failedScopeMine && failed24h.length === 0 ? '' : ' for your flows'}</div>
          )}
          <ul className="rows">
            {failedShown.slice(0, 3).map(e => (
              <li key={e.id}>
                <Link to={execLink(e)} className="row-link">
                  <span className="name">{e.flowName || flowById.get(e.flowId)?.name || e.flowId}</span>
                  <span className="meta">{formatClock(e.startTime)} · {formatDuration(e.duration)}</span>
                </Link>
                {canRunExec(e) && flowById.has(e.flowId) && (
                  <button
                    className="tc-icon-btn"
                    onClick={() => handleRerun(e)}
                    disabled={rerunningId === e.id}
                    title="Re-run on the same worker and branch"
                    aria-label={`Re-run ${e.flowName}`}
                  >
                    <RotateCcw size={13} className={rerunningId === e.id ? 'animate-spin' : ''} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {failedShown.length > 3 && (
            <Link to="/executions" className="more">+{failedShown.length - 3} more in executions</Link>
          )}
        </div>

        <div className="cell">
          <div className="cap">running now</div>
          <div className={`big ${running.length ? 'acc' : 'quiet'}`}>{running.length}</div>
          {running.length === 0 && <div className="calm quiet">Nothing in flight</div>}
          <ul className="rows">
            {running.slice(0, 3).map(e => (
              <li key={e.id}>
                <Link to={execLink(e)} className="row-link">
                  <span className="name">{e.flowName}{isMine(e) && <span className="you">you</span>}</span>
                  <span className="meta">
                    {e.status === 'QUEUED' ? 'queued' : formatDuration(Date.now() - new Date(e.startTime).getTime())}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {running.length > 3 && <Link to="/executions" className="more">+{running.length - 3} more</Link>}
        </div>

        <div className="cell">
          <div className="cap">workers</div>
          <div className="big">
            {workersLoading && !workers.length ? '—' : (
              <><span className={onlineWorkers.length ? 'ok' : 'err'}>{onlineWorkers.length}</span><span className="of">/{workers.length}</span></>
            )}
          </div>
          {!workersLoading && workers.length === 0 && <div className="calm quiet">Flows run on the server</div>}
          {workers.length > 0 && offlineWorkers.length === 0 && <div className="calm"><CheckCircle2 size={13} />All online</div>}
          <ul className="rows">
            {offlineWorkers.slice(0, 3).map(w => (
              <li key={w._id}>
                <Link to="/workers" className="row-link">
                  <span className="name">{w.name}</span>
                  <span className="meta warn">offline · {formatRelative(w.lastSeenAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {offlineWorkers.length > 3 && <Link to="/workers" className="more">+{offlineWorkers.length - 3} more offline</Link>}
        </div>
      </section>

      {/* Window stats */}
      <section className="tc-home-statsbar" aria-label="Statistics">
        <h2 className="tc-home-h2">Platform activity <span>{WINDOWS[windowKey].label}</span></h2>
        <div className="tc-chips" role="group" aria-label="Statistics window">
          {(Object.keys(WINDOWS) as WindowKey[]).map(k => (
            <button key={k} className={`tc-chip${windowKey === k ? ' active' : ''}`} onClick={() => chooseWindow(k)} aria-pressed={windowKey === k}>
              {k}
            </button>
          ))}
        </div>
      </section>
      {statsError && <div className="tc-home-error">Statistics unavailable: {statsError}</div>}
      <div className="tc-home-kpis">
        <div className="kpi">
          <div className="cap">runs</div>
          <div className="val">{stats ? nf.format(stats.total) : '—'}</div>
          {stats && <Bars buckets={stats.buckets} pick={b => b.total} max={maxBucket} tone="accent" title={b => `${bucketLabel(b)} · ${b.total} runs`} />}
        </div>
        <div className="kpi">
          <div className="cap">success rate</div>
          <div className={`val ${successRate === null ? '' : successRate >= 95 ? 'ok' : successRate >= 80 ? 'warn' : 'err'}`}>
            {successRate === null ? '—' : `${successRate.toFixed(successRate >= 99.95 || successRate === 0 ? 0 : 1)}%`}
          </div>
          {stats && <Bars buckets={stats.buckets} pick={b => b.ok} max={maxBucket} tone="ok" title={b => `${bucketLabel(b)} · ${b.ok} succeeded of ${b.total}`} />}
        </div>
        <div className="kpi">
          <div className="cap">failed</div>
          <div className={`val ${stats && stats.failed > 0 ? 'err' : ''}`}>{stats ? nf.format(stats.failed) : '—'}</div>
          {stats && <Bars buckets={stats.buckets} pick={b => b.failed} max={Math.max(1, ...stats.buckets.map(b => b.failed))} tone="err" title={b => `${bucketLabel(b)} · ${b.failed} failed`} />}
        </div>
        <div className="kpi">
          <div className="cap">median duration</div>
          <div className="val">{stats ? formatDuration(stats.medianMs) : '—'}</div>
          {stats && (() => {
            const meds = stats.buckets.map(b => median(b.durations) ?? 0);
            const mx = Math.max(1, ...meds);
            return <Bars buckets={stats.buckets} pick={b => median(b.durations) ?? 0} max={mx} tone="mute" title={b => `${bucketLabel(b)} · median ${formatDuration(median(b.durations))}`} />;
          })()}
        </div>
      </div>
      {stats?.sampled && (
        <div className="tc-home-note">Charts and median use the latest {SAMPLE_LIMIT} runs of this window; counts are exact.</div>
      )}

      {/* Personal columns */}
      <div className="tc-home-cols">
        <section className="tc-card">
          <header className="tc-home-cardhead">
            <h2 className="tc-home-h2">{execsMineScope ? 'Your last executions' : 'Latest executions'}</h2>
            <Link to="/executions" className="tc-home-more">All executions <ArrowRight size={12} /></Link>
          </header>
          {recentExecs.length === 0 ? (
            <div className="tc-empty">{loaded ? 'No executions yet. Run a flow and it shows up here.' : 'Loading…'}</div>
          ) : (
            <table className="tc-table tc-home-table">
              <thead>
                <tr><th>Execution</th><th>Flow</th><th>Status</th><th>Trigger</th><th>Duration</th><th>Started</th></tr>
              </thead>
              <tbody>
                {recentExecs.map(e => (
                  <tr
                    key={e.id}
                    tabIndex={0}
                    onClick={() => navigate(execLink(e))}
                    onKeyDown={ev => { if (ev.key === 'Enter') navigate(execLink(e)); }}
                  >
                    <td><ExecIdCell id={e.id} /></td>
                    <td>
                      <div className="tc-flow-name">{e.flowName}</div>
                      <div className="tc-flow-ns">{e.namespace}</div>
                    </td>
                    <td><StatusBadge status={e.status} /></td>
                    <td><span className="tc-trigger">{e.triggeredBy}{!execsMineScope && e.triggeredUser ? ` · ${e.triggeredUser}` : ''}</span></td>
                    <td><span className="tc-duration">{e.status === 'RUNNING' ? formatDuration(Date.now() - new Date(e.startTime).getTime()) : formatDuration(e.duration)}</span></td>
                    <td><span className="tc-home-rel">{formatRelative(e.startTime)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="tc-card">
          <header className="tc-home-cardhead">
            <h2 className="tc-home-h2">
              {myFlows.scopeMine ? 'Your flows' : 'Recently active flows'}
              {myFlows.scopeMine && ownedCount > 0 && <span>{ownedCount} owned</span>}
            </h2>
            <Link to="/flows" className="tc-home-more">All flows <ArrowRight size={12} /></Link>
          </header>
          {myFlows.list.length === 0 ? (
            <div className="tc-empty">
              {loaded ? <>No flows yet. {canEdit && <Link to="/flows" className="tc-home-more inline">Create one</Link>}</> : 'Loading…'}
            </div>
          ) : (
            <ul className="tc-home-flows">
              {myFlows.list.map(f => {
                const runs = runsByFlow.get(f.id) || [];
                const last = runs[0] || f.lastExecution;
                return (
                  <li key={f.id}>
                    <Link to={`/flows/${f.id}`} className="flow-row">
                      <span className="who">
                        <span className="name">{f.name}</span>
                        <span className="ns">
                          {f.namespace}
                          {f.owner && (f.owner || '').toLowerCase() !== me ? ` · by ${f.owner}` : ''}
                          {f.schedule?.enabled ? ` · cron ${f.schedule.cron}` : ''}
                        </span>
                      </span>
                      <span className="hist">
                        <RunTicks runs={[...runs].reverse()} />
                        <span className={`last ${last?.status === 'FAILED' ? 'err' : ''}`}>
                          {last ? formatRelative(last.startTime) : 'never run'}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
