import fs from 'fs';
import path from 'path';
import { runProcess } from './processRunner';
import { INBOX, nowUid, safeUnlink, normalizeOutput } from './shared';
import type { LogStreamFn, NodeResult } from './types';

export async function runPowershell(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_ps_${uid}.ps1`);
  const outputPath = path.join(INBOX, `worker_ps_${uid}.output`);
  const variablesPath = path.join(INBOX, `worker_ps_${uid}.variables.json`);

  fs.writeFileSync(variablesPath, JSON.stringify(variables), 'utf8');
  const inputVar = input !== undefined && input !== null ? String(input).replace(/"/g, '""') : '';
  const varNames = Object.keys(variables);
  const escVarPath = variablesPath.replace(/\\/g, '\\\\');

  const varLoad = varNames.length > 0
    ? `$__variablesJson = Get-Content -Path "${escVarPath}" -Raw | ConvertFrom-Json\n` + varNames.map(n => `$${n} = $__variablesJson.${n}`).join('\n')
    : '';
  const varCapture = varNames.length > 0
    ? `$__captured = @{\n${varNames.map(n => `    '${n}' = $${n}`).join('\n')}\n}\n$__captured | ConvertTo-Json -Depth 10 | Set-Content -Path "${escVarPath}"`
    : '';

  const wrapped = `${varLoad}
$env:INPUT="${inputVar}"
$env:OUTPUT="${outputPath.replace(/"/g, '`"')}"
${code}
${varCapture}
`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const cmd = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const { exitCode, stderr, stdout } = await runProcess(cmd, ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', scriptPath], { timeoutMs, onLog, shell: true });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);

    let output: any = null;
    if (fs.existsSync(outputPath)) {
      output = fs.readFileSync(outputPath, 'utf8').trim();
    } else if (stdout) {
      output = stdout.trim();
    }
    if (typeof output === 'string') {
      try { output = JSON.parse(output); } catch { /* leave as string */ }
    }
    let updatedVars: Record<string, any> = {};
    if (fs.existsSync(variablesPath)) {
      try { updatedVars = JSON.parse(fs.readFileSync(variablesPath, 'utf8')); } catch { }
    }
    return { output: normalizeOutput(output), variables: updatedVars };
  } finally {
    safeUnlink(scriptPath); safeUnlink(outputPath); safeUnlink(variablesPath);
  }
}
