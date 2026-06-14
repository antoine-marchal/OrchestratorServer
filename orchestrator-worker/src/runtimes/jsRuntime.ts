// JavaScript/Node backend runtime. Beyond running the wrapped script, this
// resolves the system Node binary (pkg-aware) and rewrites the user's bare ESM
// imports to absolute file URLs so scripts written outside any node_modules tree
// still resolve packages installed in the worker process.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { runProcess } from './processRunner';
import { INBOX, nowUid, safeUnlink, normalizeOutput } from './shared';
import type { LogStreamFn, NodeResult } from './types';

// Resolve the Node executable to spawn. Pkg-bundled workers must spawn a real
// system Node — `process.execPath` would be the worker binary and pkg intercepts
// `spawn('node', ...)`. See server's nodeExecutor.getNodeExecutablePath.
function getNodeExecutablePath(): string {
  if (process.env.NODE_EXECUTABLE_PATH) return process.env.NODE_EXECUTABLE_PATH;
  if ((process as any).pkg) {
    const isWin = process.platform === 'win32';
    const exe = isWin ? 'node.exe' : 'node';
    const sep = isWin ? ';' : ':';
    const pathStr = process.env.PATH || (process.env as any).Path || '';
    for (const dir of pathStr.split(sep)) {
      if (!dir) continue;
      const candidate = path.join(dir.replace(/^"|"$/g, ''), exe);
      try { if (fs.existsSync(candidate)) return candidate; } catch { /* skip */ }
    }
    try {
      const { execSync } = require('child_process');
      const cmd = isWin ? 'where node' : 'command -v node';
      const out = execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }) as string;
      const first = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    } catch { /* not on PATH */ }
    if (isWin) {
      const candidates = [
        'C:\\Program Files\\nodejs\\node.exe',
        'C:\\Program Files (x86)\\nodejs\\node.exe',
        process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node.exe'),
      ].filter(Boolean) as string[];
      for (const c of candidates) {
        try { if (fs.existsSync(c)) return c; } catch { /* skip */ }
      }
    }
    console.warn('[worker:node-exec] No system Node found. Pkg-bundled worker will fail to run .mjs. Set NODE_EXECUTABLE_PATH to override.');
    return 'node';
  }
  return process.execPath;
}
const NODE_EXEC_PATH = getNodeExecutablePath();

// Only resolve user-script bare imports against ORCHESTRATOR_WORK_DIR first,
// then ORCHESTRATOR_EXECUTION_DIR.
const bareResolver: (spec: string) => string | null = (() => {
  const anchors = [
    process.env.ORCHESTRATOR_WORK_DIR,
    process.env.ORCHESTRATOR_EXECUTION_DIR,
  ].filter((s): s is string => !!s);
  const requires: NodeRequire[] = [];
  for (const a of anchors) {
    try { requires.push(createRequire(path.join(a, 'noop.js'))); } catch { /* skip */ }
  }
  return (spec: string): string | null => {
    for (const r of requires) {
      try {
        const resolved = r.resolve(spec);
        if (resolved && fs.existsSync(resolved)) return resolved;
      } catch { /* try next anchor */ }
    }
    return null;
  };
})();

function specToFileUrl(spec: string): string | null {
  if (!spec || /^(\.|\/|file:|node:|https?:|data:)/.test(spec)) return null;
  const resolved = bareResolver(spec);
  if (!resolved) return null;
  return 'file:///' + resolved.replace(/\\/g, '/');
}

// See server's nodeExecutor.rewriteBareEsmImports for the rationale; this
// must stay in sync. We rewrite static `import` to dynamic `await import()`
// because the resolved file is often CJS and Node's static named-export
// detector trips on packages like Playwright with `Named export 'chromium'
// not found`. Dynamic import always yields `{ default: module.exports }`.
function rewriteBareEsmImports(code: string): string {
  let n = 0;
  const tmp = () => `__esm_${++n}`;

  const renderNamed = (clause: string, src: string): string => {
    const m = clause.match(/^\{\s*([^}]*)\s*\}$/);
    if (!m) return '';
    const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const props = items.map(it => {
      const asM = it.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return asM ? `${asM[1]}: ${asM[2]}` : it;
    }).join(', ');
    return `const { ${props} } = (${src}.default && typeof ${src}.default === 'object') ? ${src}.default : ${src};`;
  };

  code = code.replace(/^[ \t]*import\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm, (m, spec) => {
    const url = specToFileUrl(spec);
    return url ? `await import(${JSON.stringify(url)});` : m;
  });

  code = code.replace(/^[ \t]*import\s+([^'";]+?)\s+from\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm,
    (m, clauseRaw: string, spec: string) => {
      const url = specToFileUrl(spec);
      if (!url) return m;
      const v = tmp();
      const out: string[] = [`const ${v} = await import(${JSON.stringify(url)});`];

      let rest = clauseRaw.trim();
      let defaultName: string | null = null;
      if (!rest.startsWith('{') && !rest.startsWith('*')) {
        const commaIdx = rest.indexOf(',');
        if (commaIdx === -1) { defaultName = rest; rest = ''; }
        else { defaultName = rest.slice(0, commaIdx).trim(); rest = rest.slice(commaIdx + 1).trim(); }
      }
      if (defaultName) out.push(`const ${defaultName} = ${v}.default ?? ${v};`);
      if (rest.startsWith('*')) {
        const nsName = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1];
        if (nsName) out.push(`const ${nsName} = ${v};`);
      } else if (rest.startsWith('{')) {
        const namedSrc = renderNamed(rest, v);
        if (namedSrc) out.push(namedSrc);
      }
      return out.join('\n');
    });

  code = code.replace(/^[ \t]*export\s+(\{[^}]+\}|\*)\s+from\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm,
    (m, _clause: string, spec: string) => {
      const url = specToFileUrl(spec);
      if (!url) return m;
      const v = tmp();
      return `const ${v} = await import(${JSON.stringify(url)});`;
    });

  code = code.replace(/(\bimport\s*\(\s*)['"]([^'"]+)['"](\s*\))/g, (m, pre, spec, post) => {
    const url = specToFileUrl(spec);
    return url ? `${pre}${JSON.stringify(url)}${post}` : m;
  });

  return code;
}

export async function runJsBackend(code: string, input: any, variables: Record<string, any>, timeoutMs: number, onLog?: LogStreamFn): Promise<NodeResult> {
  const uid = nowUid();
  const scriptPath = path.join(INBOX, `worker_jsb_${uid}.mjs`);
  const outputPath = path.join(INBOX, `worker_jsb_${uid}.output`);
  const variablesPath = path.join(INBOX, `worker_jsb_${uid}.variables`);

  const varNames = Object.keys(variables);
  const varDecl = varNames.map(n => `let ${n} = __variables[${JSON.stringify(n)}];`).join('\n');
  const varCapture = varNames.length > 0
    ? `try { fs.writeFileSync(${JSON.stringify(variablesPath)}, JSON.stringify({ ${varNames.join(', ')} }), 'utf8'); } catch {}`
    : '';

  // Rewrite bare specifiers in the user's code so ESM resolution works even
  // when the script lives outside any node_modules tree.
  const userCode = rewriteBareEsmImports(code);

  const wrapped = `import fs from 'fs';
let output = "";
const input = ${JSON.stringify(input)};
const __variables = ${JSON.stringify(variables)};
${varDecl}
${userCode}
${varCapture}
fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(output), 'utf8');
`;

  fs.writeFileSync(scriptPath, wrapped, 'utf8');
  try {
    const { exitCode, stderr } = await runProcess(NODE_EXEC_PATH, [scriptPath], { timeoutMs, onLog });
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
    safeUnlink(scriptPath); safeUnlink(outputPath); safeUnlink(variablesPath);
  }
}
