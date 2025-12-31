import React, { useState, useEffect } from 'react';
import AceEditor from 'react-ace';
import { X, FileCode, Save, ExternalLink } from 'lucide-react';
import { useFlowStore } from '../store/sessionFlowStore';
import { pathUtils } from '../utils/pathUtils';
import { useTheme } from "../context/ThemeContext";

// Import Ace Editor modes & themes
import * as ace from 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/mode-java';
import 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/mode-groovy';
import 'ace-builds/src-noconflict/mode-batchfile';
import 'ace-builds/src-noconflict/mode-powershell';
import 'ace-builds/src-noconflict/theme-dracula';
import 'ace-builds/src-noconflict/theme-github';
import 'ace-builds/src-noconflict/snippets/groovy';
import 'ace-builds/src-noconflict/snippets/javascript';
import 'ace-builds/src-noconflict/snippets/powershell';
import 'ace-builds/src-noconflict/snippets/batchfile';
import SnippetsProvider from "../utils/SnippetsProvider";


import prettier from "prettier/standalone";
import parserBabel from "prettier/plugins/babel";
import pluginEstree from "prettier/plugins/estree";

interface CodeEditorModalProps {
  nodeId: string;
  code: string;
  language: string;
  onClose: () => void;
}

const CodeEditorModal: React.FC<CodeEditorModalProps> = ({
  nodeId,
  code,
  language,
  onClose,
}) => {
  const { theme } = useTheme();
  const { updateNodeData, flowPath, nodes } = useFlowStore();
  const [value, setValue] = React.useState(code);
  const [isValid, setIsValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExternalFile, setIsExternalFile] = useState(false);
  const [externalFilePath, setExternalFilePath] = useState<string | null>(null);
  const editorRef = React.useRef<any>(null);
  // Get the node data to check if it has a codeFilePath
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


  const handleSave = async () => {
    try {
      // TODO: Replace with browser API for file operations
      // If this is an external file, update both the node data and the file
      /*
      if (isExternalFile && externalFilePath) {
        let absoluteFilePath = externalFilePath;

        if (!pathUtils.isAbsolute(externalFilePath) && flowPath) {
          const baseDir = pathUtils.dirname(flowPath);
          absoluteFilePath = pathUtils.join(baseDir, externalFilePath);
        }

        if (window.electronAPI?.writeTextFile) {
          try {
            await window.electronAPI.writeTextFile(absoluteFilePath, value);
            console.log(`Updated external code file: ${absoluteFilePath}`);
          } catch (err) {
            console.error(`Error writing to external file: ${err}`);
            setIsValid(false);
            setError(`Failed to update external file: ${err instanceof Error ? err.message : String(err)}`);
            return;
          }
        }
      }
      */

      // Always update the node data with the new code
      updateNodeData(nodeId, { code: value });
      onClose();
    } catch (err) {
      setIsValid(false);
      setError(err instanceof Error ? err.message : 'Invalid code');
    }
  };


  const createExternalFile = async () => {
    // In browser environment, download the code as a file instead of creating external files
    try {
      // Determine file extension based on language
      let extension;
      switch (language.toLowerCase()) {
        case 'javascript':
        case 'jsbackend':
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
        default:
          extension = 'txt';
      }

      // Create filename based on node label or default
      const node = nodes.find(n => n.id === nodeId);
      const baseName = node?.data?.label?.replace(/[^a-zA-Z0-9_\-]/g, '_') || `node_${nodeId}`;
      const fileName = `${baseName}.${extension}`;

      // Create and download the file
      const blob = new Blob([value], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      // Update the node to mark it as having an external file (for UI purposes)
      updateNodeData(nodeId, { codeFilePath: fileName });
      setIsExternalFile(true);
      setExternalFilePath(fileName);

    } catch (err) {
      setError(`Failed to download file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Ace does not provide markers like Monaco, so skip handleEditorValidation

  // Choose mode for Ace (js/java)
  // map "language" -> Ace mode
  const languageToAceMode: Record<string, string> = {

    javascript: 'javascript',
    jsbackend: 'javascript',
    groovy: 'groovy',
    batch: 'batchfile',
    powershell: 'powershell',

  };

  const FORMATTABLE_LANGS = new Set(["javascript", "jsbackend"]);

  // Seul JS est réellement supporté par Prettier ici
  function modeToPrettierParserLimited(lang: string | undefined, modeId: string | undefined) {
    const l = (lang || "").toLowerCase();
    if (l !== "javascript") return null; // groovy/batch/powershell: pas de parser → null
    const m = (modeId || "").toLowerCase();
    if (m.includes("javascript")) return "babel";
    return null;
  }

  async function formatWithPrettierEditor(editor: any, language: string) {
    const code = editor.getValue();
    const lang = (language || "").toLowerCase();

    if (lang === "javascript") {
      const formatted = await prettier.format(code, {
        parser: "babel",
        plugins: [parserBabel, pluginEstree], // <-- ajoute estree ici
      });
      const pos = editor.getCursorPosition();
      editor.session.setValue(formatted);
      editor.moveCursorToPosition(pos);
      return;
    }
  }

  // normalise l’entrée et choisis le mode Ace, sinon fallback "text"
  const aceMode =
    languageToAceMode[(language || '').toLowerCase()] ?? 'javascript';

  React.useEffect(() => {
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
    // Make sure to include handleSave and onClose in deps
  }, [handleSave, onClose, value, isValid]);

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
            {!isExternalFile && flowPath && (
              <button
                onClick={createExternalFile}
                className="flex items-center px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm"
              >
                <FileCode className="w-4 h-4 mr-1" />
                Create External File
              </button>
            )}
            {FORMATTABLE_LANGS.has((language || "").toLowerCase()) && (
              <button
                onClick={() => editorRef.current && formatWithPrettierEditor(editorRef.current, 'javascript')}
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
              className={`flex items-center px-3 py-1.5 rounded-lg  text-white text-sm ${isValid
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
          <SnippetsProvider>
            <AceEditor
              mode={aceMode}
              theme={theme === "dark" ? "dracula" : "github"}
              name="code-editor"
              width="100%"
              height="100%"
              fontSize={14}
              value={value}
              onChange={(val) => setValue(val ?? '')}
              onLoad={(editor: any) => {
                const langTools = (ace as any).require('ace/ext/language_tools');
                const { snippetManager } = (ace as any).require('ace/snippets');

                editorRef.current = editor;
                editor.commands.addCommand({
                  name: 'expandSnippetTab',
                  bindKey: { win: 'Tab', mac: 'Tab' },
                  exec: (ed: any) => (snippetManager && snippetManager.expandWithTab(ed)) || ed.indent(),
                  multiSelect: true,
                });
                if (aceMode === 'javascript' || aceMode === 'jsbackend') {
                  editor.commands.addCommand({
                    name: "formatDoc",
                    bindKey: { win: "Ctrl-Shift-F", mac: "Command-Shift-F" },
                    exec: (ed: any) => formatWithPrettierEditor(ed, 'javascript'),
                  });
                }
                const withScore = (completer: any, score: number) => ({
                  getCompletions(ed: any, sess: any, pos: any, prefix: string, cb: any) {
                    completer.getCompletions(ed, sess, pos, prefix, (err: any, results: any[] = []) => {
                      if (err) return cb(err);
                      results.forEach((r: any) => { if (typeof r.score !== 'number') r.score = score; });
                      cb(null, results);
                    });
                  }
                });

                // Priorités
                const snippetC = withScore(langTools.snippetCompleter, 10000); // 1) snippets
                const localC = withScore(langTools.textCompleter, 5000);     // 3) local
                const keywordC = withScore(langTools.keyWordCompleter, 100);  // 4) keywords
                editor.completers = [snippetC, localC, keywordC];


              }}

              setOptions={{
                enableBasicAutocompletion: true,
                enableLiveAutocompletion: true,
                showLineNumbers: true,
                tabSize: 2,
                enableSnippets: true,
                useWorker: false,
                wrap: true,
              }}
              editorProps={{ $blockScrolling: true }}
            />
          </SnippetsProvider>
        </div>
      </div>
    </div>
  );
};

export default CodeEditorModal;
