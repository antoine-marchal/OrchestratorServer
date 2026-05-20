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
    if (req.query.scope) query.scope = req.query.scope;
    const secrets = await col.find(query);
    // Never return encrypted values
    res.json(secrets.map((s: any) => ({ _id: s._id, name: s.name, scope: s.scope, flowId: s.flowId, ownerId: s.ownerId, createdAt: s.createdAt, updatedAt: s.updatedAt })));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  const { name, value, scope = 'global', flowId } = req.body;
  if (!name || !value) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name and value required' } }) as any;

  try {
    const col = getCollection('secrets');
    const masterKey = getMasterKey();
    const { ciphertext, iv, tag } = encrypt(value, masterKey);
    const now = new Date().toISOString();
    const secret = {
      _id: uuidv4(), name, value_enc: ciphertext, iv, tag,
      scope, flowId: flowId || undefined, ownerId: (req as any).user?._id || 'system',
      createdAt: now, updatedAt: now,
    };
    await col.insert(secret);
    res.status(201).json({ _id: secret._id, name, scope, flowId: secret.flowId, createdAt: now });
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
export async function resolveSecretValues(names: string[]): Promise<{ values: Record<string, string>; missing: string[] }> {
  const col = getCollection('secrets');
  const masterKey = getMasterKey();
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of new Set(names)) {
    const secret = await col.findOne({ name });
    if (secret) values[name] = decrypt(secret.value_enc, secret.iv, masterKey, secret.tag);
    else missing.push(name);
  }
  return { values, missing };
}

// Substitute resolved values into code. Missing names become the literal
// `undefined` so inlined code stays syntactically valid (avoids "missing : after
// property id" from the raw `${{ secrets.NAME }}` token being parsed as JS).
export function substituteSecrets(text: string, values: Record<string, string>): string {
  return text.replace(SECRET_REF_RE, (_m, name: string) => (name in values ? String(values[name]) : 'undefined'));
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

export async function resolveSecretsDetailed(text: string): Promise<ResolvedSecrets> {
  const names = extractSecretNames(text);
  if (!names.length) return { text, missing: [], resolved: [] };
  const { values, missing } = await resolveSecretValues(names);
  return { text: substituteSecrets(text, values), missing, resolved: names.filter(n => n in values) };
}

// Backwards-compatible string-only API.
export async function resolveSecrets(text: string): Promise<string> {
  const { text: out } = await resolveSecretsDetailed(text);
  return out;
}

export default router;
