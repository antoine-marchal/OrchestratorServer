import React, { useState, useEffect, useRef } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import { ArrowLeft, FileCode, Save } from 'lucide-react';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useSessionStore } from '../../store/sessionStore';
import { useTheme } from '../../context/ThemeContext';
import { jsSnippets, groovySnippets, batchSnippets, powershellSnippets, pythonSnippets } from '../../utils/monacoSnippets';
import prettier from 'prettier/standalone';
import parserBabel from 'prettier/plugins/babel';
import pluginEstree from 'prettier/plugins/estree';

const languageToMonacoLang: Record<string, string> = {
  javascript: 'javascript', jsbackend: 'javascript', playwright: 'javascript',
  groovy: 'java', batch: 'bat', powershell: 'powershell', python: 'python',
};

const FORMATTABLE = new Set(['javascript', 'jsbackend', 'playwright']);

interface NodeCodePanelProps {
  nodeId: string;
}

export const NodeCodePanel: React.FC<NodeCodePanelProps> = ({ nodeId }) => {
  const { theme } = useTheme();
  const { nodes, updateNodeData } = useFlowStore();
  const sessionStore = useSessionStore();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);

  const node = nodes.find(n => n.id === nodeId);
  const language = node?.data?.type || 'javascript';
  const monacoLang = languageToMonacoLang[language] ?? 'javascript';
  const [value, setValue] = useState(node?.data?.code || '');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(node?.data?.code || '');
  }, [nodeId]);

  // Debounced auto-save: when `value` diverges from the persisted code,
  // schedule a write 600ms after the user stops typing.
  useEffect(() => {
    if (!node) return;
    if ((node.data?.code || '') === value) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      updateNodeData(nodeId, { code: value });
      setSavedAt(Date.now());
    }, 600);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [value, nodeId, node?.data?.code]);

  useEffect(() => {
    return () => { disposablesRef.current.forEach(d => d.dispose()); disposablesRef.current = []; };
  }, []);

  const handleClose = () => sessionStore.closeNodeEditor();

  // Save & return to graph (Ctrl+S, save button, or auto-triggered).
  // Cancels any pending autosave so we don't fire a redundant write.
  const handleSave = () => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    updateNodeData(nodeId, { code: value });
    sessionStore.closeNodeEditor();
  };

  const formatWithPrettier = async () => {
    if (!editorRef.current) return;
    const code = editorRef.current.getValue();
    if (!FORMATTABLE.has(language)) return;
    try {
      const formatted = await prettier.format(code, { parser: 'babel', plugins: [parserBabel, pluginEstree] });
      const pos = editorRef.current.getPosition();
      editorRef.current.setValue(formatted);
      if (pos) editorRef.current.setPosition(pos);
    } catch { }
  };

  const handleWillMount: BeforeMount = (monaco) => {
    const reg = (lang: string, snippets: any[]) => {
      const p = monaco.languages.registerCompletionItemProvider(lang, {
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
          return { suggestions: snippets.map((s, i) => ({ label: s.label, kind: monaco.languages.CompletionItemKind.Snippet, insertText: s.insertText, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: s.documentation || '', sortText: `0${String(i).padStart(4, '0')}`, range })) };
        },
      });
      disposablesRef.current.push(p);
    };
    reg('javascript', jsSnippets);
    reg('java', groovySnippets);
    reg('bat', batchSnippets);
    reg('powershell', powershellSnippets);
    reg('python', pythonSnippets);
  };

  // Stable refs so the global keydown listener can be registered once and still
  // see the latest handler closures. Previously the effect depended on `value`
  // and re-registered on every keystroke — the capture-phase add/remove cycle
  // was racing with the first keystroke being delivered to Monaco, causing the
  // initial character to be dropped.
  const handleSaveRef = useRef(handleSave);
  const handleCloseRef = useRef(handleClose);
  handleSaveRef.current = handleSave;
  handleCloseRef.current = handleClose;

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => handleSaveRef.current());
    ed.addCommand(monaco.KeyCode.Escape, () => handleCloseRef.current());
    if (FORMATTABLE.has(language)) {
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => formatWithPrettier());
    }
    // Defer focus past the current paint so React's parent re-render (which
    // re-mounts the wrapping panel when activeCard flips to 'code') has
    // finished and won't steal focus back. Otherwise the first key after
    // opening the panel was being swallowed.
    requestAnimationFrame(() => {
      ed.focus();
      const model = ed.getModel();
      if (model) ed.setPosition({ lineNumber: model.getLineCount(), column: model.getLineMaxColumn(model.getLineCount()) });
    });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); handleCloseRef.current(); }
      const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
      if (isSave) { e.preventDefault(); handleSaveRef.current(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  if (!node) return (
    <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-3)' }}>Node not found</div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        <button onClick={handleClose} className="tc-btn ghost" style={{ height: 26, padding: '0 8px', gap: 4, fontSize: 12 }}>
          <ArrowLeft size={12} />
          Graph
        </button>
        <span className="text-sm font-medium flex-1 truncate" style={{ color: 'var(--text)' }}>{node.data?.label || nodeId}</span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-3)', color: 'var(--text-3)' }}>{language}</span>
        {FORMATTABLE.has(language) && (
          <button onClick={formatWithPrettier} className="tc-btn ghost" style={{ height: 26, padding: '0 8px', gap: 4, fontSize: 12 }}>
            <FileCode size={12} />
            Format
          </button>
        )}
        {savedAt && (Date.now() - savedAt) < 2500 && (
          <span className="text-xs flex items-center gap-1" style={{ color: 'var(--ok)', fontFamily: 'var(--font-mono)' }}>
            <Save size={11} /> Saved
          </span>
        )}
        <button onClick={handleSave} className="tc-btn" style={{ height: 26, padding: '0 8px', gap: 4, fontSize: 12 }}>
          <Save size={12} />
          Save
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={monacoLang}
          value={value}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          onChange={(val) => setValue(val ?? '')}
          beforeMount={handleWillMount}
          onMount={handleMount}
          options={{
            fontSize: 13, minimap: { enabled: true, side: 'right' }, lineNumbers: 'on', tabSize: 2,
            wordWrap: 'on', automaticLayout: true, scrollBeyondLastLine: false,
            snippetSuggestions: 'top', suggestOnTriggerCharacters: true, quickSuggestions: true,
            acceptSuggestionOnEnter: 'on', tabCompletion: 'on', parameterHints: { enabled: true },
            suggest: { showSnippets: true, snippetsPreventQuickSuggestions: false, localityBonus: true },
          }}
        />
      </div>
    </div>
  );
};

export default NodeCodePanel;
