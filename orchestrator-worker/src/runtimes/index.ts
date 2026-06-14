// Runtime registry + node dispatcher. Maps a node type to its language runtime;
// `executeNode` resolves the runtime and runs it, handling the few non-process
// node types (variable/comment/goto) inline.
import { runJsBackend } from './jsRuntime';
import { runPython } from './pythonRuntime';
import { runGroovy } from './groovyRuntime';
import { runPowershell } from './powershellRuntime';
import { runBatch } from './batchRuntime';
import { runShell } from './shellRuntime';
import type { LogStreamFn, NodeResult, Runtime } from './types';

export type { LogStreamFn, NodeResult, Runtime } from './types';

// node type → language runtime. Aliases share one runner.
const runtimes: Record<string, Runtime> = {
  jsbackend: runJsBackend,
  javascript: runJsBackend,
  python: runPython,
  groovy: runGroovy,
  powershell: runPowershell,
  batch: runBatch,
  shell: runShell,
  bash: runShell,
};

export async function executeNode(node: any, onLog?: LogStreamFn): Promise<NodeResult> {
  const type: string = node?.type || node?.data?.type;
  const data = node?.data || {};
  const code: string = data.code || '';
  const input: any = data.input ?? null;
  const variables: Record<string, any> = data.variables || {};
  const timeoutMs: number = data.timeout ? parseInt(data.timeout) * 1000 : 0;

  const runtime = runtimes[type];
  if (runtime) return runtime(code, input, variables, timeoutMs, onLog);

  switch (type) {
    case 'variable':
      return { output: variables[data.variableName] ?? input, variables };
    case 'comment':
    case 'goto':
      return { output: input, variables };
    default:
      throw new Error(`Unsupported node type on ${process.platform} worker: ${type}`);
  }
}
