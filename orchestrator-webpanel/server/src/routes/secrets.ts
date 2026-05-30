import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../services/db/index';
import { encrypt, decrypt, getMasterKey } from '../services/crypto/aes';
import { requireRole } from '../middleware/rbac';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const col = getCollection('secrets');
    const query: any = {};
    if (req.query.flowId) query.flowId = req.query.flowId;
    if (req.query.workerId) query.workerId = req.query.workerId;
    if (req.query.scope) query.scope = req.query.scope;
    const secrets = await col.find(query);
    // Never return encrypted values
    res.json(secrets.map((s: any) => ({ _id: s._id, name: s.name, scope: s.scope, flowId: s.flowId, workerId: s.workerId, ownerId: s.ownerId, createdAt: s.createdAt, updatedAt: s.updatedAt })));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  const { name, value, scope = 'global', flowId, workerId } = req.body;
  if (!name || !value) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name and value required' } }) as any;
  if (scope === 'worker' && !workerId) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'workerId required for worker-scoped secret' } }) as any;
  }

  try {
    const col = getCollection('secrets');
    const masterKey = getMasterKey();
    const { ciphertext, iv, tag } = encrypt(value, masterKey);
    const now = new Date().toISOString();
    const secret: any = {
      _id: uuidv4(), name, value_enc: ciphertext, iv, tag,
      scope, ownerId: (req as any).user?._id || 'system',
      createdAt: now, updatedAt: now,
    };
    if (scope === 'flow' && flowId) secret.flowId = flowId;
    if (scope === 'worker' && workerId) secret.workerId = workerId;
    await col.insert(secret);
    res.status(201).json({ _id: secret._id, name, scope, flowId: secret.flowId, workerId: secret.workerId, createdAt: now });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const col = getCollection('secrets');
    const removed = await col.remove({ _id: req.params.id });
    if (!removed) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Secret not found' } }) as any;
    res.json({ message: 'Secret deleted' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/:id/reveal', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const col = getCollection('secrets');
    const secret = await col.findOne({ _id: req.params.id });
    if (!secret) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Secret not found' } }) as any;
    const masterKey = getMasterKey();
    const value = decrypt(secret.value_enc, secret.iv, masterKey, secret.tag);
    res.json({ value });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

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
// same name. See `feedback_url_handling` / project docs for the user-facing
// semantics of `{{ secrets.NAME }}`.
export interface ResolveCtx { workerId?: string | null; flowId?: string | null }
export async function resolveSecretValues(names: string[], ctx: ResolveCtx = {}): Promise<{ values: Record<string, string>; missing: string[] }> {
  const col = getCollection('secrets');
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

export default router;
