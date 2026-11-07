import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Download, X, FileText, Maximize2, Minimize2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// Read-only Monaco viewer for a user-pushed (non-managed) repo file surfaced in
// NodeFileTree. No editing/commit — purely to inspect a pushed README/.gitignore/
// docs file. Download uses the shared transfer modal (handled by the caller).

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', html: 'html', htm: 'html', css: 'css', scss: 'scss',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', cs: 'csharp', php: 'php', sh: 'shell', bash: 'shell', ps1: 'powershell',
  bat: 'bat', sql: 'sql', xml: 'xml', toml: 'ini', ini: 'ini', dockerfile: 'dockerfile',
  txt: 'plaintext', gitignore: 'plaintext', env: 'plaintext',
};

function langForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const ext = lower.includes('.') ? lower.split('.').pop()! : lower.replace(/^\./, '');
  return EXT_TO_LANG[ext] || 'plaintext';
}

export interface RepoFile { name: string; path: string; content: string }

export function RepoFileViewer({ file, onClose, onDownload }: {
  file: RepoFile;
  onClose: () => void;
  onDownload: () => void;
}) {
  const { theme } = useTheme();
  const [maximized, setMaximized] = useState(false);
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...(maximized
            ? { borderRadius: 0, width: '100vw', height: '100vh', maxWidth: '100vw' }
            : { borderRadius: 8, width: 860, maxWidth: '92vw', height: '80vh' }),
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-3)' }}>
          <FileText size={13} style={{ color: 'var(--accent)' }} />
          <span className="truncate flex-1" style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{file.path}</span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>read-only</span>
          <button onClick={onDownload} className="tc-btn ghost" style={{ height: 24, padding: '0 8px', gap: 4, fontSize: 11 }} title="Download">
            <Download size={12} /> Download
          </button>
          <button onClick={() => setMaximized(m => !m)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }} title={maximized ? 'Restore' : 'Maximize'}>
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }} title="Close">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <Editor
            height="100%"
            language={langForName(file.name)}
            value={file.content}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: true, domReadOnly: true, fontSize: 13, minimap: { enabled: true },
              lineNumbers: 'on', wordWrap: 'on', automaticLayout: true, scrollBeyondLastLine: false,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default RepoFileViewer;
