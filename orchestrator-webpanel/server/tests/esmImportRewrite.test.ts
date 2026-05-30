import { describe, it, expect } from 'vitest';

// Reproduce the production rewriter shape here so the regex contract is
// pinned by tests. If you change rewriteBareEsmImports in nodeExecutor.ts,
// mirror the change here.
function specToFileUrl(spec: string, resolve: (s: string) => string | null): string | null {
  if (!spec || /^(\.|\/|file:|node:|https?:|data:)/.test(spec)) return null;
  const r = resolve(spec);
  return r ? 'file:///' + r.replace(/\\/g, '/') : null;
}

function rewrite(code: string, resolve: (s: string) => string | null): string {
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
    const url = specToFileUrl(spec, resolve);
    return url ? `await import(${JSON.stringify(url)});` : m;
  });
  code = code.replace(/^[ \t]*import\s+([^'";]+?)\s+from\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm,
    (m, clauseRaw, spec) => {
      const url = specToFileUrl(spec, resolve);
      if (!url) return m;
      const v = tmp();
      const out: string[] = [`const ${v} = await import(${JSON.stringify(url)});`];
      let rest = clauseRaw.trim();
      let defaultName: string | null = null;
      if (!rest.startsWith('{') && !rest.startsWith('*')) {
        const ci = rest.indexOf(',');
        if (ci === -1) { defaultName = rest; rest = ''; }
        else { defaultName = rest.slice(0, ci).trim(); rest = rest.slice(ci + 1).trim(); }
      }
      if (defaultName) out.push(`const ${defaultName} = ${v}.default ?? ${v};`);
      if (rest.startsWith('*')) {
        const ns = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1];
        if (ns) out.push(`const ${ns} = ${v};`);
      } else if (rest.startsWith('{')) {
        const ns = renderNamed(rest, v);
        if (ns) out.push(ns);
      }
      return out.join('\n');
    });
  code = code.replace(/(\bimport\s*\(\s*)['"]([^'"]+)['"](\s*\))/g, (m, pre, spec, post) => {
    const url = specToFileUrl(spec, resolve);
    return url ? `${pre}${JSON.stringify(url)}${post}` : m;
  });
  return code;
}

const stub = (s: string) => s === 'playwright' ? 'C:\\nm\\playwright\\index.js' : null;

describe('ESM bare specifier rewriter', () => {
  it('rewrites named import via dynamic import + .default fallback', () => {
    const out = rewrite(`import { chromium } from 'playwright';`, stub);
    expect(out).toContain(`await import("file:///C:/nm/playwright/index.js")`);
    expect(out).toContain(`const { chromium } = (__esm_1.default && typeof __esm_1.default === 'object') ? __esm_1.default : __esm_1;`);
  });

  it('rewrites default import', () => {
    const out = rewrite(`import pw from 'playwright';`, stub);
    expect(out).toContain(`const pw = __esm_1.default ?? __esm_1;`);
  });

  it('rewrites namespace import', () => {
    const out = rewrite(`import * as pw from 'playwright';`, stub);
    expect(out).toContain(`const pw = __esm_1;`);
  });

  it('rewrites mixed default + named', () => {
    const out = rewrite(`import pw, { chromium } from 'playwright';`, stub);
    expect(out).toContain(`const pw = __esm_1.default ?? __esm_1;`);
    expect(out).toContain(`const { chromium } = (__esm_1.default && typeof __esm_1.default === 'object') ? __esm_1.default : __esm_1;`);
  });

  it('rewrites named with alias', () => {
    const out = rewrite(`import { chromium as cr } from 'playwright';`, stub);
    expect(out).toContain(`const { chromium: cr } =`);
  });

  it('rewrites side-effect-only import', () => {
    expect(rewrite(`import 'playwright';`, stub))
      .toBe(`await import("file:///C:/nm/playwright/index.js");`);
  });

  it('rewrites bare specifier inside dynamic import()', () => {
    expect(rewrite(`const p = await import('playwright');`, stub))
      .toBe(`const p = await import("file:///C:/nm/playwright/index.js");`);
  });

  it('leaves relative imports alone', () => {
    const src = `import x from './local.js';`;
    expect(rewrite(src, stub)).toBe(src);
  });

  it('leaves node: and file: scheme imports alone', () => {
    const src = `import fs from 'node:fs';\nimport x from 'file:///abs.mjs';`;
    expect(rewrite(src, stub)).toBe(src);
  });

  it('leaves unresolvable specifiers untouched', () => {
    const src = `import x from 'not-installed';`;
    expect(rewrite(src, stub)).toBe(src);
  });
});
