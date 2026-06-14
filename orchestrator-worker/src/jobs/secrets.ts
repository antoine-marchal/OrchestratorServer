// Resolve `${{ secrets.NAME }}` placeholders in a node's code at execution time.
// The job record only carries the placeholders; we fetch the decrypted values
// from the orchestrator over the worker channel right before running.
import { http } from '../transport/httpClient';

const SECRET_REF_RE = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;

// JS-family node types where a missing secret should become the literal
// `undefined` (keeps the inlined code syntactically valid). Other languages
// (python/groovy/powershell/batch/shell/bash) get an empty string — `undefined`
// is not a valid token there.
const JS_NODE_TYPES = new Set(['javascript', 'jsbackend']);

export async function resolveSecrets(
  workerId: string,
  jobId: string,
  code: string,
  onLog: (type: 'log' | 'error', message: string) => void,
  nodeType?: string,
): Promise<string> {
  if (!code || !code.includes('${{')) return code;
  const names = [...new Set([...code.matchAll(SECRET_REF_RE)].map(m => m[1]))];
  if (!names.length) return code;

  let values: Record<string, string> = {};
  try {
    const res = await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/secrets`, { names });
    values = (res.data && res.data.values) || {};
  } catch (e: any) {
    onLog('error', `[secrets] failed to fetch secrets: ${e.message}`);
  }

  const resolved = names.filter(n => n in values);
  const missing = names.filter(n => !(n in values));
  if (resolved.length) onLog('log', `[secrets] resolved: ${resolved.join(', ')}`);
  if (missing.length) onLog('error', `[secrets] no secret found for: ${missing.map(m => `\`${m}\``).join(', ')} — create one in /admin or remove the placeholder`);

  // Missing names: `undefined` for JS (keeps it syntactically valid), empty
  // string elsewhere so we don't inject a bogus token into Python/Groovy/etc.
  const missingFill = nodeType && JS_NODE_TYPES.has(nodeType) ? 'undefined' : '';
  return code.replace(SECRET_REF_RE, (_m, name: string) => (name in values ? String(values[name]) : missingFill));
}
