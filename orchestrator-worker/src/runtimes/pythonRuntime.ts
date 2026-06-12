import fs from 'fs';
import path from 'path';
import { runProcess } from './processRunner';
import { INBOX, nowUid, safeUnlink, normalizeOutput } from './shared';
import type { LogStreamFn, NodeResult } from './types';

export async function runPython(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_py_${uid}.py`);
  const inputPath = path.join(INBOX, `worker_py_${uid}.input`);
  const outputPath = path.join(INBOX, `worker_py_${uid}.output`);
  const variablesPath = path.join(INBOX, `worker_py_${uid}.variables.json`);

  fs.writeFileSync(inputPath, JSON.stringify(input ?? null), 'utf8');
  fs.writeFileSync(variablesPath, JSON.stringify(variables), 'utf8');
  const ip = inputPath.replace(/\\/g, '/'), op = outputPath.replace(/\\/g, '/'), vp = variablesPath.replace(/\\/g, '/');

  const varNames = Object.keys(variables);
  const varLoad = varNames.map(n => `${n} = __variables.get(${JSON.stringify(n)})`).join('\n');
  const varCapture = varNames.length > 0
    ? `with open(${JSON.stringify(vp)}, 'w') as __f:\n    json.dump({${varNames.map(n => `${JSON.stringify(n)}: ${n}`).join(', ')}}, __f)`
    : '';

  const wrapped = `import json
with open(${JSON.stringify(ip)}, 'r') as __f:
    input = json.load(__f)
with open(${JSON.stringify(vp)}, 'r') as __f:
    __variables = json.load(__f)
${varLoad}
output = None
${code}
${varCapture}
with open(${JSON.stringify(op)}, 'w') as __f:
    json.dump(output, __f)
`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stderr } = await runProcess('python', [scriptPath], { timeoutMs, onLog, shell: true });
    if (exitCode !== 0) throw new Error(stderr || `Process exited with code ${exitCode}`);

    let output: any = null;
    if (fs.existsSync(outputPath)) {
      const raw = fs.readFileSync(outputPath, 'utf8').trim();
      try { output = JSON.parse(raw); } catch { output = raw; }
    }
    let updatedVars: Record<string, any> = {};
    if (fs.existsSync(variablesPath)) {
      try { updatedVars = JSON.parse(fs.readFileSync(variablesPath, 'utf8')); } catch { }
    }
    return { output: normalizeOutput(output), variables: updatedVars };
  } finally {
    safeUnlink(scriptPath); safeUnlink(inputPath); safeUnlink(outputPath); safeUnlink(variablesPath);
  }
}
