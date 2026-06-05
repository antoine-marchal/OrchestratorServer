import React, { useState } from 'react';
import { apiClient } from '../../utils/apiClient';

// Active-branch picker for a flow. Branches are lazy-loaded the first time the
// select is opened (avoids N requests when rendered in a list). Selecting a
// branch checks it out server-side (materializes its HEAD into the flow doc —
// the executor runs the active branch) then notifies the parent to refresh.
export const BranchSelect: React.FC<{
  flowId: string;
  activeBranch?: string;
  onChanged?: () => void;
  // When provided, selecting a branch just reports it (no checkout) — used by
  // subrow variants that target a branch without changing the flow's active one.
  onSelect?: (branch: string) => void;
  style?: React.CSSProperties;
}> = ({ flowId, activeBranch, onChanged, onSelect, style }) => {
  const [branches, setBranches] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = activeBranch || 'main';

  const ensure = async () => {
    if (loaded) return;
    try {
      const data: any = await apiClient.get(`/api/v1/flows/${flowId}/branches`);
      const list: string[] = Array.isArray(data?.branches) ? data.branches : [];
      if (!list.includes(current)) list.unshift(current);
      setBranches(list);
    } catch { setBranches([current]); }
    finally { setLoaded(true); }
  };

  const onChange = async (branch: string) => {
    if (branch === current) return;
    if (onSelect) { onSelect(branch); return; }
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/flows/${flowId}/branches/${encodeURIComponent(branch)}/checkout`);
      onChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Branch checkout failed');
    } finally { setBusy(false); }
  };

  const opts = branches.length ? branches : [current];
  return (
    <select
      value={current}
      disabled={busy}
      onMouseDown={ensure}
      onFocus={ensure}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value); }}
      title="Active git branch"
      style={style}
    >
      {(opts.includes(current) ? opts : [current, ...opts]).map(b => (
        <option key={b} value={b}>{b}</option>
      ))}
    </select>
  );
};

export default BranchSelect;
