import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getCollection } from '../services/db/index';
import { executeOrchestratorFlow } from '../services/executor/flowExecutor';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';

const router = Router();

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Revoke a trigger token
router.post('/trigger-tokens/:id/revoke', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
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
      // Atomically claim the token: only the first of N concurrent requests
      // flips used:false→true and gets a non-zero modified count. The rest
      // lose the race and are rejected, so the flow fires exactly once.
      const claimed = await tokensCol.update({ _id: tokenDoc._id, used: false }, { $set: { used: true } });
      if (!claimed) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Single-use token already used' } }) as any;
    }

    // Variant triggers carry a worker/branch override; verify the subrow still
    // exists so a deleted variant's token can't fire a ghost run.
    let ov: { workerId?: string; branch?: string } | undefined;
    if (schedule.variantId) {
      const flow = await getCollection('flows').findOne({ _id: schedule.flowId });
      const exists = flow && Array.isArray(flow.variants) && flow.variants.some((v: any) => v.id === schedule.variantId);
      if (!exists) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Subrow no longer exists' } }) as any;
      ov = { workerId: schedule.workerId ?? '', branch: schedule.branch };
    }
    const executionId = await executeOrchestratorFlow(schedule.flowId, 'api', undefined, ov);
    res.json({ executionId, message: 'Flow triggered' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
