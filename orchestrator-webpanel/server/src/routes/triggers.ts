import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getCollection } from '../services/db/index';
import { executeOrchestratorFlow } from '../services/executor/flowExecutor';

const router = Router();

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Revoke a trigger token
router.post('/trigger-tokens/:id/revoke', async (req: Request, res: Response) => {
  try {
    const col = getCollection('trigger_tokens');
    const token = await col.findOne({ _id: req.params.id });
    if (!token) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } }) as any;
    await col.update({ _id: req.params.id }, { $set: { revokedAt: new Date().toISOString() } });
    res.json({ message: 'Token revoked' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Public trigger endpoint — no auth, token in URL
router.get('/trigger/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const tokenHash = hashToken(token);

  try {
    const tokensCol = getCollection('trigger_tokens');
    const schedulesCol = getCollection('schedules');

    const tokenDoc = await tokensCol.findOne({ tokenHash });
    if (!tokenDoc) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }) as any;
    if (tokenDoc.revokedAt) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token has been revoked' } }) as any;
    if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) < new Date()) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token has expired' } }) as any;
    if (tokenDoc.singleUse && tokenDoc.used) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Single-use token already used' } }) as any;

    const schedule = await schedulesCol.findOne({ _id: tokenDoc.scheduleId });
    if (!schedule || !schedule.enabled) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Schedule not found or disabled' } }) as any;

    if (tokenDoc.singleUse) {
      await tokensCol.update({ _id: tokenDoc._id }, { $set: { used: true } });
    }

    const executionId = await executeOrchestratorFlow(schedule.flowId, 'api');
    res.json({ executionId, message: 'Flow triggered' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
