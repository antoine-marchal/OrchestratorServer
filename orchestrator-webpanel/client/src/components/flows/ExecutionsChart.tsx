import React, { useMemo, useState } from 'react';
import type { ExecutionStatus } from '../../types/flows';

interface ChartExec {
  status: ExecutionStatus;
  startTime: string;
}

interface ExecutionsChartProps {
  executions: ChartExec[];
}

const STATUS_ORDER: ExecutionStatus[] = ['SUCCESS', 'FAILED', 'KILLED', 'RUNNING', 'QUEUED'];
const STATUS_COLOR: Record<ExecutionStatus, string> = {
  SUCCESS: 'var(--ok)',
  FAILED: 'var(--err)',
  KILLED: 'var(--warn)',
  RUNNING: 'var(--accent)',
  QUEUED: 'var(--text-mute)',
};
const STATUS_LABEL: Record<ExecutionStatus, string> = {
  SUCCESS: 'Success', FAILED: 'Failed', KILLED: 'Killed', RUNNING: 'Running', QUEUED: 'Queued',
};

const DAY_MS = 86400000;

function dayKey(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function fmtDay(t: number): string {
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtDayFull(t: number): string {
  return new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const ExecutionsChart: React.FC<ExecutionsChartProps> = ({ executions }) => {
  const [hover, setHover] = useState<number | null>(null);

  const { bars, maxTotal, presentStatuses, axisLabels } = useMemo(() => {
    const times = executions
      .map(e => new Date(e.startTime).getTime())
      .filter(t => !isNaN(t));
    if (times.length === 0) {
      return { bars: [], maxTotal: 0, presentStatuses: [] as ExecutionStatus[], axisLabels: [] as { idx: number; label: string }[] };
    }
    const minDay = dayKey(Math.min(...times));
    const maxDay = dayKey(Math.max(...times));
    const nDays = Math.round((maxDay - minDay) / DAY_MS) + 1;

    const bars = Array.from({ length: nDays }, (_, i) => {
      const day = minDay + i * DAY_MS;
      const counts: Partial<Record<ExecutionStatus, number>> = {};
      return { day, counts, total: 0 };
    });

    for (const e of executions) {
      const t = new Date(e.startTime).getTime();
      if (isNaN(t)) continue;
      const idx = Math.round((dayKey(t) - minDay) / DAY_MS);
      if (idx < 0 || idx >= nDays) continue;
      const b = bars[idx];
      b.counts[e.status] = (b.counts[e.status] ?? 0) + 1;
      b.total += 1;
    }

    const maxTotal = Math.max(1, ...bars.map(b => b.total));
    const present = STATUS_ORDER.filter(s => bars.some(b => (b.counts[s] ?? 0) > 0));

    const axisLabels: { idx: number; label: string }[] = [];
    const step = Math.max(1, Math.ceil(nDays / 8));
    for (let i = 0; i < nDays; i += step) {
      axisLabels.push({ idx: i, label: fmtDay(bars[i].day) });
    }

    return { bars, maxTotal, presentStatuses: present, axisLabels };
  }, [executions]);

  if (bars.length === 0) return null;

  const H = 140; // chart body height in px
  const nDays = bars.length;

  return (
    <div className="tc-card" style={{ padding: '14px 16px 10px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em' }}>
          // executions per day
        </span>
        <div style={{ display: 'flex', gap: 12 }}>
          {presentStatuses.map(s => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: STATUS_COLOR[s], display: 'inline-block' }} />
              {STATUS_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {/* Y axis */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: H, fontSize: 10, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)', textAlign: 'right', minWidth: 18 }}>
          <span>{maxTotal}</span>
          <span>{Math.round(maxTotal / 2)}</span>
          <span>0</span>
        </div>

        {/* Bars */}
        <div style={{ position: 'relative', flex: 1, height: H, display: 'flex', alignItems: 'flex-end', gap: nDays > 40 ? 1 : 4, borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)', paddingLeft: 4 }}>
          {/* grid line at 50% */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', borderTop: '1px dashed var(--border)' }} />
          {bars.map((b, i) => (
            <div
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(h => (h === i ? null : h))}
              style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative', cursor: b.total ? 'pointer' : 'default' }}
            >
              {STATUS_ORDER.filter(s => (b.counts[s] ?? 0) > 0).map(s => (
                <div
                  key={s}
                  style={{
                    height: `${((b.counts[s] ?? 0) / maxTotal) * 100}%`,
                    background: STATUS_COLOR[s],
                    opacity: hover === null || hover === i ? 1 : 0.45,
                    minHeight: 1,
                    transition: 'opacity 120ms',
                  }}
                />
              ))}
              {hover === i && b.total > 0 && (
                <div style={{
                  position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
                  marginTop: 8, background: 'var(--bg-2)', border: '1px solid var(--border-strong)',
                  borderRadius: 6, padding: '6px 8px', fontSize: 11, whiteSpace: 'nowrap', zIndex: 10,
                  boxShadow: '0 6px 18px -6px rgba(0,0,0,0.5)', pointerEvents: 'none',
                }}>
                  <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
                    {fmtDayFull(b.day)}
                  </div>
                  {STATUS_ORDER.filter(s => (b.counts[s] ?? 0) > 0).map(s => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-2)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[s] }} />
                      {STATUS_LABEL[s]}: {b.counts[s]}
                    </div>
                  ))}
                  <div style={{ marginTop: 3, color: 'var(--text-3)' }}>total: {b.total}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* X axis labels */}
      <div style={{ display: 'flex', marginLeft: 26, marginTop: 4, position: 'relative', height: 14 }}>
        {axisLabels.map(a => (
          <span
            key={a.idx}
            style={{
              position: 'absolute',
              left: `${(a.idx / nDays) * 100}%`,
              fontSize: 10, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
            }}
          >
            {a.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export default ExecutionsChart;
