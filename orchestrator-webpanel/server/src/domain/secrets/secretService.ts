// Secret resolution domain logic. Framework-free — no Express. The HTTP layer
// (routes/secrets.ts) owns CRUD; this owns the `${{ secrets.NAME }}` placeholder
// semantics shared by the worker callback endpoint and the flow executor.
import { secretRepository } from '../../data/repositories';
import { decrypt, getMasterKey } from '../../infra/crypto/aes';

// Single source of truth for the `${{ secrets.NAME }}` placeholder syntax.
export const SECRET_REF_RE = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;

// Pull the distinct secret names referenced by a piece of code/config.
export function extractSecretNames(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(SECRET_REF_RE)) out.add(m[1]);
  return Array.from(out);
}

// Decrypt a set of secrets by name. Returns a name→plaintext map for the ones
// that exist plus the list of names that don't. Used by the worker callback
// endpoint so secret plaintext is only ever produced at node-execution time —
// never baked into a queued/persisted job record.
//
// Resolution precedence per name:
//   1. worker-scoped secret matching ctx.workerId (most specific)
//   2. flow-scoped secret matching ctx.flowId
//   3. global secret
// The most specific match wins so a worker can shadow a global value with the
// same name.
export interface ResolveCtx { workerId?: string | null; flowId?: string | null }
export async function resolveSecretValues(names: string[], ctx: ResolveCtx = {}): Promise<{ values: Record<string, string>; missing: string[] }> {
  const col = secretRepository;
  const masterKey = getMasterKey();
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of new Set(names)) {
    let secret: any = null;
    if (ctx.workerId) {
      secret = await col.findOne({ name, scope: 'worker', workerId: ctx.workerId });
    }
    if (!secret && ctx.flowId) {
      secret = await col.findOne({ name, scope: 'flow', flowId: ctx.flowId });
    }
    if (!secret) {
      secret = await col.findOne({ name, scope: 'global' });
    }
    if (!secret) {
      // Backwards-compat: legacy rows without a `scope` field — treat any
      // bare-name match as global so existing secrets still resolve after the
      // schema gained scope filtering.
      secret = await col.findOne({ name });
    }
    if (secret) values[name] = decrypt(secret.value_enc, secret.iv, masterKey, secret.tag);
    else missing.push(name);
  }
  return { values, missing };
}

// JS-family node types where a missing secret should become the literal
// `undefined` (keeps inlined code syntactically valid). For every other
// language (python, groovy, powershell, batch, shell, bash) `undefined` is the
// wrong token — there an empty string is the safe fill.
const JS_NODE_TYPES = new Set(['javascript', 'jsbackend']);
export function missingSecretFill(nodeType?: string | null): string {
  return nodeType && JS_NODE_TYPES.has(nodeType) ? 'undefined' : '';
}

// Substitute resolved values into code. Missing names become `missingFill`
// (default `undefined` for JS; pass '' for other languages — see
// missingSecretFill). Avoids injecting the bare token `undefined` into Python
// etc. where it is not a valid value.
export function substituteSecrets(text: string, values: Record<string, string>, missingFill: string = 'undefined'): string {
  return text.replace(SECRET_REF_RE, (_m, name: string) => (name in values ? String(values[name]) : missingFill));
}

// Utility: resolve `${{ secrets.NAME }}` references in code/config at execution
// time. Returns the substituted text plus a list of any names that were
// referenced but didn't exist — callers should surface those to the user
// because an unresolved placeholder usually breaks downstream parsing.
export interface ResolvedSecrets {
  text: string;
  missing: string[];
  resolved: string[];
}

export async function resolveSecretsDetailed(text: string, ctx: ResolveCtx = {}, nodeType?: string | null): Promise<ResolvedSecrets> {
  const names = extractSecretNames(text);
  if (!names.length) return { text, missing: [], resolved: [] };
  const { values, missing } = await resolveSecretValues(names, ctx);
  return { text: substituteSecrets(text, values, missingSecretFill(nodeType)), missing, resolved: names.filter(n => n in values) };
}

// Backwards-compatible string-only API.
export async function resolveSecrets(text: string, ctx: ResolveCtx = {}, nodeType?: string | null): Promise<string> {
  const { text: out } = await resolveSecretsDetailed(text, ctx, nodeType);
  return out;
}
