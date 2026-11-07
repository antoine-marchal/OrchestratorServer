import * as monaco from 'monaco-editor';
import loader from '@monaco-editor/loader';
import editorWorker from 'monaco-editor/editor/editor.worker?worker&inline';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker&inline';

window.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

loader.config({ monaco });
