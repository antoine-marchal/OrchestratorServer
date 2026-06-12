// Shared runtime contracts. A Runtime takes a node's code + I/O context and
// returns its output and any variable mutations. Every per-language runner
// (js/python/groovy/powershell/batch/shell) implements this signature.
export type LogStreamFn = (type: 'log' | 'error', message: string) => void;
export type NodeResult = { output: any; variables: Record<string, any> };

export type Runtime = (
  code: string,
  input: any,
  variables: Record<string, any>,
  timeoutMs: number,
  onLog?: LogStreamFn,
) => Promise<NodeResult>;

export interface RunOpts {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdinData?: string;
  timeoutMs?: number;
  onLog?: LogStreamFn;
  shell?: boolean;
}
