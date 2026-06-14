import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Shown once after an API key is created — the raw key is never retrievable again.
export function RawKeyModal({ rawKey, onClose }: { rawKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-lg p-6 w-full max-w-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>API Key Created</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--err)' }}>
          This key will not be shown again. Copy and store it securely.
        </p>
        <div className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--bg-3)', border: '1px solid var(--border)' }}>
          <code className="text-xs flex-1 truncate" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{rawKey}</code>
          <button onClick={copy} className="tc-btn ghost" style={{ height: 24, padding: '0 8px', gap: 4, fontSize: 11 }}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="tc-btn" style={{ height: 28, padding: '0 14px', fontSize: 12 }}>Done</button>
        </div>
      </div>
    </div>
  );
}
