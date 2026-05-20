import { Router, Request, Response, NextFunction } from 'express';
import { getCollection } from '../services/db/index';
import { nowUid } from '../services/executor/nodeExecutor';
import { executeOrchestratorFlow } from '../services/executor/flowExecutor';

const router = Router();

// Operators can edit any flow whose owner is either themselves or another
// operator. They cannot edit admin-owned flows. Admins can edit anything.
async function canUserEditFlow(user: any, flow: any): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'operator') return false;
  const ownerLogin = flow?.owner;
  if (!ownerLogin) return true; // legacy unowned: treat as operator-editable
  if (ownerLogin === user.login) return true;
  const usersCol = getCollection('users');
  const owner = await usersCol.findOne({ login: ownerLogin });
  // Owner missing/deleted → treat as operator (don't trap edits to nobody).
  if (!owner) return true;
  return owner.role !== 'admin';
}

async function requireFlowEditAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as any).user;
  if (!user) { res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }); return; }
  if (user.role !== 'admin' && user.role !== 'operator') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only admins and operators can edit flows' } });
    return;
  }
  const flow = await getCollection('flows').findOne({ _id: req.params.id });
  // Missing flow on PUT means upsert (create) — admins and operators may
  // create. On DELETE the caller will hit a 404 inside the handler itself.
  if (!flow) { next(); return; }
  const ok = await canUserEditFlow(user, flow);
  if (!ok) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot edit a flow owned by an admin' } }); return; }
  next();
}

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
  const owner = (req as any).user?.login || 'unknown';
  const flow = { _id: nowUid(), name, namespace, description, nodes, edges, workerId, owner, schedule: null, createdAt: now, updatedAt: now, lastExecution: null };
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

// Minimum interval between two snapshots of the same flow. Rapid autosaves
// inside this window collapse into a single "editing session" — the first
// PUT in the window snapshots the prior state, every later PUT in the
// same window skips snapshotting so the history doesn't fill with noise.
// Defaults to 10 min, override via ORCHESTRATOR_VERSION_MIN_INTERVAL_MS.
const VERSION_MIN_INTERVAL_MS =
  Number(process.env.ORCHESTRATOR_VERSION_MIN_INTERVAL_MS ?? 10 * 60 * 1000);

router.put('/:id', requireFlowEditAccess, async (req: Request, res: Response) => {
  const now = new Date().toISOString();
  try {
    const col = getCollection('flows');
    const versionsCol = getCollection('flow_versions');
    let flow = await col.findOne({ _id: req.params.id });
    if (!flow) {
      const { name = 'Untitled', namespace = 'default', description = '', nodes = [], edges = [], workerId = '', artifacts = [] } = req.body;
      const owner = (req as any).user?.login || 'unknown';
      flow = { _id: req.params.id, name, namespace, description, nodes, edges, workerId, artifacts, owner, schedule: null, createdAt: now, updatedAt: now, lastExecution: null };
      await col.insert(flow);
    } else {
      // Snapshot the previous version into flow_versions when the graph or
      // artifacts changed. A 10-minute window collapses bursts of autosaves
      // into a single snapshot per editing session.
      const graphChanged =
        (Array.isArray(req.body.nodes) && JSON.stringify(req.body.nodes) !== JSON.stringify(flow.nodes || []))
        || (Array.isArray(req.body.edges) && JSON.stringify(req.body.edges) !== JSON.stringify(flow.edges || []))
        || (Array.isArray(req.body.artifacts) && JSON.stringify(req.body.artifacts) !== JSON.stringify(flow.artifacts || []));
      if (graphChanged) {
        try {
          // Find the most recent snapshot for this flow. Skip writing a new
          // one if the last is younger than the configured min interval.
          const recent = await versionsCol.find({ flowId: req.params.id }, { sort: { savedAt: -1 }, limit: 1 });
          const last = recent && recent.length ? recent[0] : null;
          const lastAgeMs = last ? Date.now() - new Date(last.savedAt).getTime() : Infinity;
          if (lastAgeMs >= VERSION_MIN_INTERVAL_MS) {
            await versionsCol.insert({
              _id: nowUid(),
              flowId: req.params.id,
              nodes: flow.nodes || [],
              edges: flow.edges || [],
              artifacts: flow.artifacts || [],
              name: flow.name,
              namespace: flow.namespace,
              description: flow.description,
              savedAt: flow.updatedAt || now,
              author: (req as any).user?.login || 'unknown',
            });
          }
        } catch (e: any) {
          console.warn('[flows] failed to snapshot version:', e.message);
        }
      }
      const updates: any = { updatedAt: now };
      for (const key of ['name', 'namespace', 'description', 'nodes', 'edges', 'workerId', 'artifacts', 'owner']) {
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

router.get('/:id/versions', async (req: Request, res: Response) => {
  try {
    const versionsCol = getCollection('flow_versions');
    const versions = await versionsCol.find({ flowId: req.params.id });
    versions.sort((a: any, b: any) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    // Trim the payload — clients ask for the full body via /:vid when they
    // want to diff or restore. Keep a node count so the list is informative.
    res.json(versions.map((v: any) => ({
      _id: v._id, flowId: v.flowId, savedAt: v.savedAt, author: v.author,
      name: v.name, nodeCount: (v.nodes || []).length, edgeCount: (v.edges || []).length,
    })));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/:id/versions/:vid', async (req: Request, res: Response) => {
  try {
    const versionsCol = getCollection('flow_versions');
    const v = await versionsCol.findOne({ _id: req.params.vid, flowId: req.params.id });
    if (!v) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } }) as any;
    res.json(v);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/:id/versions/:vid/restore', async (req: Request, res: Response) => {
  const now = new Date().toISOString();
  try {
    const col = getCollection('flows');
    const versionsCol = getCollection('flow_versions');
    const v = await versionsCol.findOne({ _id: req.params.vid, flowId: req.params.id });
    if (!v) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } }) as any;
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    // Snapshot the current state first so restore is itself reversible.
    try {
      await versionsCol.insert({
        _id: nowUid(),
        flowId: req.params.id,
        nodes: flow.nodes || [],
        edges: flow.edges || [],
        artifacts: flow.artifacts || [],
        name: flow.name,
        namespace: flow.namespace,
        description: flow.description,
        savedAt: flow.updatedAt || now,
        author: (req as any).user?.login || 'unknown',
      });
    } catch { /* best effort */ }
    await col.update({ _id: req.params.id }, { $set: {
      nodes: v.nodes || [], edges: v.edges || [], artifacts: v.artifacts || [], updatedAt: now,
    } });
    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/:id', requireFlowEditAccess, async (req: Request, res: Response) => {
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
