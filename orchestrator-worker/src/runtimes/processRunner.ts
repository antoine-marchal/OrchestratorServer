// Low-level child-process runner shared by every language runtime. Streams
// stdout/stderr back via onLog, enforces a timeout (tree-kill), and optionally
// promotes a clean exit to a failure when output contains an ERROR/FAILED token.
import { spawn } from 'child_process';
import kill from 'tree-kill';
import { EXECUTION_DIR } from './shared';
import type { RunOpts } from './types';

// Build a single shell command line from an executable + args.
// `spawn(cmd, args, { shell: true })` is deprecated (Node DEP0190): the args
// array is concatenated into the shell line unescaped. When we need a shell
// (Windows PATH/PATHEXT lookup of `python`/`java`/`powershell`) we pass one
// pre-quoted string instead, which also fixes paths containing spaces.
// Mirrors server's nodeExecutor.toShellCommand.
export function toShellCommand(cmd: string, args: string[]): string {
  const quote = (a: string) =>
    a === '' || /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
  return [cmd, ...args].map(quote).join(' ');
}

// When ORCHESTRATOR_FAIL_ON_LOG_ERROR=true, scan combined stdout+stderr for an
// ERROR/FAILED token after the process exits cleanly. If matched, synthesise a
// non-zero exit code so the calling runtime throws and the node is reported failed.
const FAIL_ON_LOG_ERROR =
  String(process.env.ORCHESTRATOR_FAIL_ON_LOG_ERROR ?? 'false').toLowerCase() === 'true';
const LOG_ERROR_PATTERN = /\b(ERROR|FAILED)\b/;

export function runProcess(cmd: string, args: string[], opts: RunOpts): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const useShell = opts.shell ?? false;
    const child = useShell
      ? spawn(toShellCommand(cmd, args), {
          cwd: opts.cwd || EXECUTION_DIR,
          env: { ...process.env, ...opts.env },
          shell: true,
        })
      : spawn(cmd, args, {
          cwd: opts.cwd || EXECUTION_DIR,
          env: { ...process.env, ...opts.env },
          shell: false,
        });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { const t = d.toString(); stdout += t; opts.onLog?.('log', t); });
    child.stderr?.on('data', (d: Buffer) => { const t = d.toString(); stderr += t; opts.onLog?.('error', t); });

    let timer: NodeJS.Timeout | null = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (child.pid) kill(child.pid);
        resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', exitCode: -1 });
      }, opts.timeoutMs);
    }

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      let exitCode = code ?? 0;
      let finalStderr = stderr;
      if (FAIL_ON_LOG_ERROR && exitCode === 0) {
        const m = (stdout + '\n' + stderr).match(LOG_ERROR_PATTERN);
        if (m) {
          exitCode = 1;
          finalStderr = (stderr ? stderr + '\n' : '') + `[log-error-trigger] matched '${m[0]}' (ORCHESTRATOR_FAIL_ON_LOG_ERROR=true)`;
        }
      }
      resolve({ stdout, stderr: finalStderr, exitCode });
    });

    if (opts.stdinData !== undefined) { child.stdin?.write(opts.stdinData); child.stdin?.end(); }
  });
}
