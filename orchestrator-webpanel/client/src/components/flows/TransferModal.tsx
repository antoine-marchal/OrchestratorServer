
import { CheckCircle2, Loader2, X } from 'lucide-react';

// Shared upload/download progress modal. Originally inline in FlowDetail for
// artifact transfers; extracted so the editor file tree can reuse the exact same
// panel for downloading user-pushed (non-managed) repo files.

export interface TransferItem { name: string; pct: number; done: boolean; error?: string }
export interface TransferState { mode: 'upload' | 'download'; items: TransferItem[] }

export function TransferModal({ transfer, onClose }: { transfer: TransferState | null; onClose: () => void }) {
  if (!transfer) return null;
  const allDone = transfer.items.every(u => u.done);
  const verb = transfer.mode === 'upload' ? 'Upload' : 'Download';
  const gerund = transfer.mode === 'upload' ? 'Uploading' : 'Downloading';
  const n = transfer.items.length;
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => { if (allDone) onClose(); }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, width: 440, maxWidth: '90vw', padding: 16, fontFamily: 'var(--font-mono)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {allDone
            ? <CheckCircle2 size={14} style={{ color: 'var(--ok)' }} />
            : <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {allDone ? `${verb} complete` : `${gerund} ${n} file${n > 1 ? 's' : ''}…`}
          </span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }} title="Close">
            <X size={14} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '50vh', overflow: 'auto' }}>
          {transfer.items.map((u, i) => (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                <span style={{ flexShrink: 0, color: u.error ? 'var(--err)' : u.done ? 'var(--ok)' : 'var(--text-3)' }}>
                  {u.error ? 'failed' : u.done ? 'done' : `${u.pct}%`}
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${u.error ? 100 : u.pct}%`, background: u.error ? 'var(--err)' : 'var(--accent)', transition: 'width 0.15s' }} />
              </div>
              {u.error && <div style={{ fontSize: 10, color: 'var(--err)', marginTop: 2 }}>{u.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default TransferModal;
