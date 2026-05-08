import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../services/db/index';
import { nowUid } from '../services/executor/nodeExecutor';
import { register as registerCron, unregister as unregisterCron } from '../services/scheduler/cronScheduler';

const router = Router();

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// List schedules for a flow
router.get('/', async (req: Request, res: Response) => {
  try {
    const col = getCollection('schedules');
    const query: any = {};
    if (req.query.flowId) query.flowId = req.query.flowId;
    const schedules = await col.find(query);
    res.json({ schedules, total: schedules.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Create cron schedule
router.post('/cron', async (req: Request, res: Response) => {
  const { flowId, cronExpr, label, enabled = true } = req.body;
  if (!flowId || !cronExpr) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'flowId and cronExpr required' } }) as any;
  try {
    const col = getCollection('schedules');
    const now = new Date().toISOString();
    const schedule: any = {
      _id: uuidv4(), flowId, type: 'cron', cronExpr, label: label || cronExpr,
      createdBy: (req as any).user?._id || 'system', enabled,
      createdAt: now, updatedAt: now,
    };
    await col.insert(schedule);
    if (enabled) registerCron(schedule);
    res.status(201).json(schedule);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Create event-based schedule
router.post('/event', async (req: Request, res: Response) => {
  const { flowId, eventName, label, enabled = true } = req.body;
  if (!flowId || !eventName) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'flowId and eventName required' } }) as any;
  try {
    const col = getCollection('schedules');
    const now = new Date().toISOString();
    const schedule: any = {
      _id: uuidv4(), flowId, type: 'event', eventName, label: label || eventName,
      createdBy: (req as any).user?._id || 'system', enabled,
      createdAt: now, updatedAt: now,
    };
    await col.insert(schedule);
    res.status(201).json(schedule);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Create API trigger
router.post('/api-trigger', async (req: Request, res: Response) => {
  const { flowId, label, expiresAt, singleUse = false } = req.body;
  if (!flowId) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'flowId required' } }) as any;
  try {
    const schedulesCol = getCollection('schedules');
    const tokensCol = getCollection('trigger_tokens');
    const now = new Date().toISOString();

    const schedule: any = {
      _id: uuidv4(), flowId, type: 'api', label: label || 'API Trigger',
      createdBy: (req as any).user?._id || 'system', enabled: true,
      createdAt: now, updatedAt: now,
    };
    await schedulesCol.insert(schedule);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const token: any = {
      _id: uuidv4(), scheduleId: schedule._id, label: label || 'API Trigger',
      tokenHash, createdBy: (req as any).user?._id || 'system',
      expiresAt: expiresAt || undefined, singleUse, used: false,
      createdAt: now,
    };
    await tokensCol.insert(token);

    const host = `${req.protocol}://${req.get('host')}`;
    const triggerUrl = `${host}/api/v1/trigger/${rawToken}`;

    res.status(201).json({ token: rawToken, url: triggerUrl, scheduleId: schedule._id, tokenId: token._id, message: 'Save this token — it will not be shown again' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Toggle enable/disable
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const col = getCollection('schedules');
    const schedule = await col.findOne({ _id: req.params.id });
    if (!schedule) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Schedule not found' } }) as any;

    const updates: any = { updatedAt: new Date().toISOString() };
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
    if (req.body.label !== undefined) updates.label = req.body.label;
    if (req.body.cronExpr !== undefined) updates.cronExpr = req.body.cronExpr;

    await col.update({ _id: req.params.id }, { $set: updates });
    const updated = await col.findOne({ _id: req.params.id });

    // Re-register or unregister cron
    if (updated.type === 'cron') {
      unregisterCron(updated._id);
      if (updated.enabled) registerCron(updated);
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const col = getCollection('schedules');
    const schedule = await col.findOne({ _id: req.params.id });
    if (!schedule) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Schedule not found' } }) as any;

    if (schedule.type === 'cron') unregisterCron(schedule._id);
    await col.remove({ _id: req.params.id });

    // Remove associated tokens
    const tokensCol = getCollection('trigger_tokens');
    await tokensCol.remove({ scheduleId: req.params.id }, { multi: true });

    res.json({ message: 'Schedule deleted' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Get tokens for a schedule
router.get('/:id/tokens', async (req: Request, res: Response) => {
  try {
    const col = getCollection('trigger_tokens');
    const tokens = await col.find({ scheduleId: req.params.id });
    res.json(tokens.map((t: any) => ({ _id: t._id, label: t.label, scheduleId: t.scheduleId, singleUse: t.singleUse, used: t.used, expiresAt: t.expiresAt, revokedAt: t.revokedAt, createdAt: t.createdAt })));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
