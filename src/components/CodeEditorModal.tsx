import React, { useState, useEffect, useRef } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import { X, FileCode, Save, ExternalLink } from 'lucide-react';
import { useFlowStore } from '../store/sessionFlowStore';
import { useTheme } from "../context/ThemeContext";

import { jsSnippets, groovySnippets, batchSnippets, powershellSnippets } from '../utils/monacoSnippets';
import { pythonSnippets } from '../utils/pythonSnippets';

import prettier from "prettier/standalone";
import parserBabel from "prettier/plugins/babel";
import pluginEstree from "prettier/plugins/estree";

interface CodeEditorModalProps {
  nodeId: string;
  code: string;
  language: string;
  onClose: () => void;
}

// Map language to Monaco language ID
const languageToMonacoLang: Record<string, string> = {
  javascript: 'javascript',
  jsbackend: 'javascript',
  playwright: 'javascript',
  groovy: 'java', // Groovy is similar to Java
  batch: 'bat',
  powershell: 'powershell',
  python: 'python',
};

const FORMATTABLE_LANGS = new Set(["javascript", "jsbackend", "playwright"]);

const CodeEditorModal: React.FC<CodeEditorModalProps> = ({
  nodeId,
  code,
  language,
  onClose,
}) => {
  const { theme } = useTheme();
  const { updateNodeData, flowPath, nodes } = useFlowStore();
  const [value, setValue] = useState(code);
  const [isValid, setIsValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExternalFile, setIsExternalFile] = useState(false);
  const [externalFilePath, setExternalFilePath] = useState<string | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);

  const node = nodes.find(n => n.id === nodeId);

  useEffect(() => {
    if (node?.data.codeFilePath) {
      setIsExternalFile(true);
      setExternalFilePath(node.data.codeFilePath);
    } else {
      setIsExternalFile(false);
      setExternalFilePath(null);
    }
  }, [node]);

  // Cleanup disposables on unmount
  useEffect(() => {
    return () => {
      disposablesRef.current.forEach(d => d.dispose());
      disposablesRef.current = [];
    };
  }, []);

  const handleSave = async () => {
    try {
      updateNodeData(nodeId, { code: value });
      onClose();
    } catch (err) {
      setIsValid(false);
      setError(err instanceof Error ? err.message : 'Invalid code');
    }
  };

  const createExternalFile = async () => {
    try {
      let extension;
      switch (language.toLowerCase()) {
        case 'javascript':
        case 'jsbackend':
        case 'playwright':
          extension = 'js';
          break;
        case 'groovy':
          extension = 'groovy';
          break;
        case 'batch':
          extension = 'bat';
          break;
        case 'powershell':
          extension = 'ps1';
          break;
        case 'python':
          extension = 'py';
          break;
        default:
          extension = 'txt';
      }

      const node = nodes.find(n => n.id === nodeId);
      const baseName = node?.data?.label?.replace(/[^a-zA-Z0-9_\-]/g, '_') || `node_${nodeId}`;
      const fileName = `${baseName}.${extension}`;

      const blob = new Blob([value], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      updateNodeData(nodeId, { codeFilePath: fileName });
      setIsExternalFile(true);
      setExternalFilePath(fileName);
    } catch (err) {
      setError(`Failed to download file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const formatWithPrettier = async () => {
    if (!editorRef.current) return;
    const code = editorRef.current.getValue();
    const lang = (language || "").toLowerCase();

    if (lang === "javascript" || lang === "jsbackend" || lang === "playwright") {
      try {
        const formatted = await prettier.format(code, {
          parser: "babel",
          plugins: [parserBabel, pluginEstree],
        });
        const position = editorRef.current.getPosition();
        editorRef.current.setValue(formatted);
        if (position) {
          editorRef.current.setPosition(position);
        }
      } catch (e) {
        console.error('Prettier format error:', e);
      }
    }
  };

  const monacoLang = languageToMonacoLang[(language || '').toLowerCase()] ?? 'javascript';

  // Register completion providers before mount
  const handleEditorWillMount: BeforeMount = (monaco) => {
    // Store monaco reference
    monacoRef.current = monaco;

    // Register snippet completion providers for each language
    const registerSnippetProvider = (langId: string, snippets: typeof jsSnippets) => {
      const provider = monaco.languages.registerCompletionItemProvider(langId, {
        provideCompletionItems: (model: { getWordUntilPosition: (position: any) => any; }, position: { lineNumber: any; }) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions = snippets.map((s, idx) => ({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: s.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: s.documentation || '',
            sortText: `0${String(idx).padStart(4, '0')}`, // Prioritize snippets
            range,
          }));

          return { suggestions };
        },
      });
      disposablesRef.current.push(provider);
    };

    // Register for JavaScript
    registerSnippetProvider('javascript', jsSnippets);
    // Register for Java (used for Groovy)
    registerSnippetProvider('java', groovySnippets);
    // Register for Batch
    registerSnippetProvider('bat', batchSnippets);
    // Register for PowerShell
    registerSnippetProvider('powershell', powershellSnippets);
    // Register for Python
    registerSnippetProvider('python', pythonSnippets);
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    editor.addCommand(monaco.KeyCode.Escape, () => {
      onClose();
    });

    // Format command for JS
    if (FORMATTABLE_LANGS.has((language || "").toLowerCase())) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
        formatWithPrettier();
      });
    }

    // Focus the editor
    editor.focus();
  };

  // Handle keyboard events at modal level
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isSave = (isMac && e.metaKey && e.key.toLowerCase() === 's')
        || (!isMac && e.ctrlKey && e.key.toLowerCase() === 's');
      if (isSave) {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [value, isValid]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="rounded-lg w-[90vw] h-[90vh] flex flex-col bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center">
            <h2 className="text-xl font-semibold dark:text-white light:text-black">Edit Code</h2>
            {isExternalFile && (
              <div className="ml-3 flex items-center bg-blue-900/50 text-blue-100 dark:text-blue-300 px-2 py-1 rounded text-xs">
                <ExternalLink className="w-3 h-3 mr-1" />
                External File: {externalFilePath}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {!isValid && (
              <span className="text-red-500 text-sm">{error}</span>
            )}
            {/** !isExternalFile && flowPath && (
              <button
                onClick={createExternalFile}
                className="flex items-center px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm"
              >
                <FileCode className="w-4 h-4 mr-1" />
                Create External File
              </button>
            )*/}
            {FORMATTABLE_LANGS.has((language || "").toLowerCase()) && (
              <button
                onClick={formatWithPrettier}
                title="Format with Prettier (Ctrl/Cmd+Shift+F)"
                className="flex items-center px-3 py-1.5 rounded-lg text-white text-sm bg-purple-600 hover:bg-purple-700"
              >
                <FileCode className="w-4 h-4 mr-1" />
                Format
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isValid}
              className={`flex items-center px-3 py-1.5 rounded-lg text-white text-sm ${isValid
                ? 'bg-blue-500 hover:bg-blue-600'
                : 'bg-gray-600 cursor-not-allowed'
                }`}
            >
              <Save className="w-4 h-4 mr-1" />
              Save
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
            >
              <X className="w-6 h-6 text-gray-400" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language={monacoLang}
            value={value}
            theme={theme === "dark" ? "vs-dark" : "light"}
            onChange={(val) => setValue(val ?? '')}
            beforeMount={handleEditorWillMount}
            onMount={handleEditorMount}
            options={{
              fontSize: 14,
              minimap: { enabled: true, side: 'right' },
              lineNumbers: 'on',
              tabSize: 2,
              wordWrap: 'on',
              automaticLayout: true,
              scrollBeyondLastLine: false,
              snippetSuggestions: 'top',
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              acceptSuggestionOnEnter: 'on',
              tabCompletion: 'on',
              parameterHints: { enabled: true },
              suggest: {
                showSnippets: true,
                snippetsPreventQuickSuggestions: false,
                localityBonus: true,
              },
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default CodeEditorModal;
