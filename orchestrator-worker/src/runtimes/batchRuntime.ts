import fs from 'fs';
import path from 'path';
import { runProcess } from './processRunner';
import { INBOX, nowUid, safeUnlink, normalizeOutput } from './shared';
import type { LogStreamFn, NodeResult } from './types';

export async function runBatch(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  if (process.platform !== 'win32') throw new Error('Batch nodes only supported on Windows');
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_bat_${uid}.bat`);
  const outputPath = path.join(INBOX, `worker_bat_${uid}.output`);

  const inputVar = input !== undefined && input !== null ? String(input).replace(/\\"/g, '\\\\\\"') : '';
  const variableEnvVars = Object.entries(variables)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([name, val]) => `set ${name}=${String(val).replace(/"/g, '\\"')}`)
    .join('\r\n');

  const wrapped = `@echo off\r\n${variableEnvVars}\r\nset INPUT="${inputVar}"\r\nset OUTPUT="${outputPath}"\r\n${code}\r\n`;
  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stderr, stdout } = await runProcess('cmd.exe', ['/c', scriptPath], { timeoutMs, onLog });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);

    let output: any = null;
    if (fs.existsSync(outputPath)) {
      output = fs.readFileSync(outputPath, 'utf8').trim();
    } else if (stdout) {
      output = stdout.trim();
    }
    if (typeof output === 'string') {
      try { if (output.startsWith('{') || output.startsWith('[')) output = JSON.parse(output); } catch { }
    }
    return { output: normalizeOutput(output), variables: {} };
  } finally {
    safeUnlink(scriptPath); safeUnlink(outputPath);
  }
}
