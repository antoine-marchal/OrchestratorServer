import fs from 'fs';
import path from 'path';
import { runProcess } from './processRunner';
import { INBOX, GROOVY_JAR, nowUid, safeUnlink, normalizeOutput } from './shared';
import type { LogStreamFn, NodeResult } from './types';

export async function runGroovy(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  if (!fs.existsSync(GROOVY_JAR)) throw new Error(`groovyExec.jar not found at ${GROOVY_JAR}`);
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_groovy_${uid}.groovy`);
  const inputPath = path.join(INBOX, `worker_groovy_${uid}.input`);
  const outputPath = path.join(INBOX, `worker_groovy_${uid}.output`);
  const variablesPath = path.join(INBOX, `worker_groovy_${uid}.variables`);

  fs.writeFileSync(inputPath, JSON.stringify(input ?? null), 'utf8');
  fs.writeFileSync(variablesPath, JSON.stringify(variables), 'utf8');
  const ip = inputPath.replace(/\\/g, '/'), op = outputPath.replace(/\\/g, '/'), vp = variablesPath.replace(/\\/g, '/');

  const varNames = Object.keys(variables);
  const varLoad = varNames.length > 0
    ? `def __variables = new groovy.json.JsonSlurper().parseText(new File('${vp}').text)\n` + varNames.map(n => `def ${n} = __variables['${n}']`).join('\n')
    : '';
  const varCapture = varNames.length > 0
    ? `def __captured = [${varNames.map(n => `'${n}': ${n}`).join(', ')}]\nnew File('${vp}').text = groovy.json.JsonOutput.toJson(__captured)`
    : '';

  const wrapped = `def smartParse = { s -> try { (s?.trim()?.startsWith('{') || s?.trim()?.startsWith('[')) && s?.contains('"') ? new groovy.json.JsonSlurper().parseText(s) : Eval.me(s) } catch(e) { s } }
${varLoad}
input = smartParse(new File('${ip}').text)
def output = ""
${code}
${varCapture}
def asJson = { obj -> try { groovy.json.JsonOutput.toJson(obj) } catch(e) { groovy.json.JsonOutput.toJson([value: obj?.toString(), error: e.toString()]) } }
new File('${op}').text = asJson(output)`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stdout, stderr } = await runProcess('java', ['-jar', GROOVY_JAR, scriptPath, 'lib'], { timeoutMs, onLog, shell: true });
    const errInStdout = /Exception|Error|Caused by|groovy\.lang|java\.lang/i.test(stdout) ? stdout : '';
    if (exitCode !== 0 || errInStdout) throw new Error(stderr || errInStdout || `Process exited with code ${exitCode}`);

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
