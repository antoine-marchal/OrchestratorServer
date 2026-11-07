import React, { useEffect, useState } from 'react';
import { ChevronRight, Copy, Check } from 'lucide-react';

interface Props {
  /** A real trigger URL when one was just created; a placeholder otherwise. */
  url?: string;
  defaultOpen?: boolean;
  /** Notified when the panel opens/closes, so a host modal can widen itself. */
  onOpenChange?: (open: boolean) => void;
}

// How to call an API trigger: fire-and-forget GET, POST with a body, the
// synchronous ?wait mode (flow as a REST endpoint) and optional caller
// identification. Mirrors documentation/API.md "Triggers (HTTP)".
const TriggerUsageHelp: React.FC<Props> = ({ url, defaultOpen = false, onOpenChange }) => {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { onOpenChange?.(open); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [copied, setCopied] = useState<number | null>(null);
  const base = url && url.startsWith('http') ? url : `${window.location.origin}/api/v1/trigger/<TOKEN>`;

  const examples: { title: string; cmd: string }[] = [
    { title: 'GET — start the flow with PARAM as input (returns the execution id at once)', cmd: `curl "${base}/PARAM"` },
    { title: 'GET — same, and wait for the result', cmd: `curl "${base}/42?wait=60"` },
    {
      title: 'POST — send a JSON body as input and wait for the result',
      cmd: `curl -X POST "${base}?wait=60" \\\n  -H "Content-Type: application/json" \\\n  -d '{"orderId": 42}'`,
    },
    {
      title: 'Optionally credit the run to a user (API key from Admin → Users)',
      cmd: `curl -X POST "${base}?wait=60" \\\n  -H "Authorization: ApiKey <YOUR_API_KEY>" \\\n  -H "Content-Type: application/json" -d '{"orderId": 42}'`,
    },
  ];

  const copy = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard denied */ }
  };

  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11 };
  const code: React.CSSProperties = { ...mono, background: 'var(--surface-hi)', padding: '0 4px', borderRadius: 3, color: 'var(--text)' };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
          background: 'none', border: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 12, fontWeight: 600, textAlign: 'left',
        }}
      >
        <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms', color: 'var(--text-2)' }} />
        How to call this trigger
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px', fontSize: 12, lineHeight: 1.55, color: 'var(--text-2)' }}>
          <ul style={{ margin: '0 0 10px', paddingLeft: 16, listStyle: 'disc' }}>
            <li><b style={{ color: 'var(--text)' }}>Input, GET.</b> A last path segment <span style={code}>/PARAM</span> is passed to the first node. If it is valid JSON it arrives parsed (<span style={code}>/42</span> is a number); URL-encode anything else.</li>
            <li><b style={{ color: 'var(--text)' }}>Input, POST.</b> The request body is passed instead: JSON arrives as an object, plain text with <span style={code}>Content-Type: text/plain</span>. With an empty body, <span style={code}>/PARAM</span> is used as on GET.</li>
            <li><b style={{ color: 'var(--text)' }}>Get the result.</b> Add <span style={code}>?wait=60</span> (seconds, max 300 by default) and the call returns when the flow ends: <span style={code}>200</span> with <span style={code}>output</span> on success, <span style={code}>500</span> with <span style={code}>error</span> if it fails, <span style={code}>202</span> with a <span style={code}>statusUrl</span> if it is still running.</li>
            <li><b style={{ color: 'var(--text)' }}>Who runs it.</b> The URL alone is enough; the run is then credited to the API trigger (caller IP). To credit a user, add <span style={code}>Authorization: ApiKey &lt;key&gt;</span> (or <span style={code}>Bearer &lt;token&gt;</span>), or an SSO ticket <span style={code}>?ticket=ST-…</span> issued for this exact URL. Wrong credentials are refused (401).</li>
            <li><b style={{ color: 'var(--text)' }}>SSO.</b> Only a plain browser GET goes through the SSO login page. POST calls, <span style={code}>?wait</span> calls and calls with credentials never redirect, so scripts work.</li>
          </ul>

          {examples.map((ex, i) => (
            <div key={i} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, marginBottom: 3 }}>{ex.title}</div>
              <div style={{ position: 'relative' }}>
                <pre style={{
                  ...mono, margin: 0, padding: '8px 34px 8px 10px', borderRadius: 6, whiteSpace: 'pre', overflowX: 'auto',
                  background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)',
                }}>{ex.cmd}</pre>
                <button
                  type="button"
                  onClick={() => copy(ex.cmd, i)}
                  title="Copy command"
                  aria-label="Copy command"
                  className="tc-icon-btn"
                  style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24 }}
                >
                  {copied === i ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            </div>
          ))}

          <p style={{ margin: '10px 0 0', fontSize: 11 }}>
            Keep the URL secret: anyone who has it can run the flow. Revoke the trigger to cut access.
          </p>
        </div>
      )}
    </div>
  );
};

export default TriggerUsageHelp;
