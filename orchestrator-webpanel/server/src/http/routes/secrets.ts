import { Router, Request, Response } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import { secretRepository } from '../../data/repositories';
import { encrypt, decrypt, getMasterKey } from '../../infra/crypto/aes';
import { requireRole } from '../middleware/rbac';
import { validateBody } from '../validators/validate';
import { createSecretSchema } from '../validators/schemas';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const col = secretRepository;
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

router.post('/', requireRole('admin', 'operator'), validateBody(createSecretSchema), async (req: Request, res: Response) => {
  const { name, value, scope, flowId, workerId } = req.body;
  try {
    const col = secretRepository;
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
    const col = secretRepository;
    const removed = await col.remove({ _id: req.params.id });
    if (!removed) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Secret not found' } }) as any;
    res.json({ message: 'Secret deleted' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/:id/reveal', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const col = secretRepository;
    const secret = await col.findOne({ _id: req.params.id });
    if (!secret) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Secret not found' } }) as any;
    const masterKey = getMasterKey();
    const value = decrypt(secret.value_enc, secret.iv, masterKey, secret.tag);
    res.json({ value });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
