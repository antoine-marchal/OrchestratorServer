import fs from 'fs';
import path from 'path';
import { runProcess } from './processRunner';
import { INBOX, nowUid, safeUnlink, normalizeOutput } from './shared';
import type { LogStreamFn, NodeResult } from './types';

export async function runShell(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  if (process.platform === 'win32') throw new Error('Shell nodes are not supported on Windows workers — use Powershell or Batch instead');
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_sh_${uid}.sh`);
  const outputPath  = path.join(INBOX, `worker_sh_${uid}.output`);

  const varExports = Object.entries(variables)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([name, val]) => `export ${name}=${JSON.stringify(String(val))}`)
    .join('\n');

  const wrapped = `#!/usr/bin/env bash\nset -e\n${varExports}\nexport INPUT=${JSON.stringify(String(input ?? ''))}\nexport OUTPUT=${JSON.stringify(outputPath)}\n${code}\n`;
  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try { fs.chmodSync(scriptPath, '755'); } catch {}

  try {
    const { exitCode, stdout, stderr } = await runProcess('bash', [scriptPath], { timeoutMs, onLog });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);
    let output: any = null;
    if (fs.existsSync(outputPath)) {
      output = fs.readFileSync(outputPath, 'utf8').trim();
    } else if (stdout) {
      output = stdout.trim();
    }
    if (typeof output === 'string') { try { output = JSON.parse(output); } catch {} }
    return { output: normalizeOutput(output), variables: {} };
  } finally {
    safeUnlink(scriptPath); safeUnlink(outputPath);
  }
}
