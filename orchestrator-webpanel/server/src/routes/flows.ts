import { Router, Request, Response } from 'express';
import { getCollection } from '../services/db/index';
import { nowUid } from '../services/executor/nodeExecutor';
import { executeOrchestratorFlow } from '../services/executor/flowExecutor';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const col = getCollection('flows');
    const flows = await col.find({});
    flows.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ flows, total: flows.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const { name, namespace = 'default', description = '', nodes = [], edges = [], workerId = '' } = req.body;
  if (!name) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name is required' } }) as any;
  const now = new Date().toISOString();
  const flow = { _id: nowUid(), name, namespace, description, nodes, edges, workerId, schedule: null, createdAt: now, updatedAt: now, lastExecution: null };
  try {
    const col = getCollection('flows');
    await col.insert(flow);
    res.status(201).json(flow);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const col = getCollection('flows');
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    res.json(flow);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const now = new Date().toISOString();
  try {
    const col = getCollection('flows');
    let flow = await col.findOne({ _id: req.params.id });
    if (!flow) {
      const { name = 'Untitled', namespace = 'default', description = '', nodes = [], edges = [], workerId = '', artifacts = [] } = req.body;
      flow = { _id: req.params.id, name, namespace, description, nodes, edges, workerId, artifacts, schedule: null, createdAt: now, updatedAt: now, lastExecution: null };
      await col.insert(flow);
    } else {
      const updates: any = { updatedAt: now };
      for (const key of ['name', 'namespace', 'description', 'nodes', 'edges', 'workerId', 'artifacts']) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      await col.update({ _id: req.params.id }, { $set: updates });
      flow = await col.findOne({ _id: req.params.id });
    }
    res.json(flow);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const col = getCollection('flows');
    const n = await col.remove({ _id: req.params.id });
    if (!n) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    res.json({ message: 'Flow deleted' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const col = getCollection('flows');
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const triggeredUser: string | undefined = (req as any).user?.login;
    const executionId = await executeOrchestratorFlow(req.params.id, 'manual', triggeredUser);
    res.json({ executionId, message: 'Execution started' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.put('/:id/schedule', async (req: Request, res: Response) => {
  const { cron, enabled = true, timezone = 'UTC' } = req.body;
  if (!cron) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'cron is required' } }) as any;
  try {
    const col = getCollection('flows');
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    await col.update({ _id: req.params.id }, { $set: { schedule: { cron, enabled, timezone }, updatedAt: new Date().toISOString() } });
    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/:id/schedule', async (req: Request, res: Response) => {
  try {
    const col = getCollection('flows');
    await col.update({ _id: req.params.id }, { $set: { schedule: null, updatedAt: new Date().toISOString() } });
    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
