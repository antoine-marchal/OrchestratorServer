import { Router, Request, Response, NextFunction } from 'express';
import { getCollection } from '../services/db/index';
import { nowUid } from '../services/executor/nodeExecutor';
import { executeOrchestratorFlow } from '../services/executor/flowExecutor';
import { register as registerCron, unregister as unregisterCron } from '../services/scheduler/cronScheduler';
import {
  commitFlowState,
  listCommits,
  flowFieldsAtCommit,
  listBranches,
  checkoutBranchToDoc,
  activeRef,
} from '../services/git/flowCommit';

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

// Reject owner assignments that target a viewer (or a missing user). Returns
// the error string when invalid, null when OK.
async function validateOwnerLogin(login: string | undefined): Promise<string | null> {
  if (!login) return null; // no change requested
  const owner = await getCollection('users').findOne({ login });
  if (!owner) return `Owner '${login}' is not a known user`;
  if (owner.role === 'viewer') return `Owner '${login}' is a viewer — viewers cannot own flows`;
  return null;
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

router.put('/:id', requireFlowEditAccess, async (req: Request, res: Response) => {
  const now = new Date().toISOString();
  try {
    const ownerError = await validateOwnerLogin(req.body?.owner);
    if (ownerError) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: ownerError } }) as any;
    const col = getCollection('flows');
    let flow = await col.findOne({ _id: req.params.id });
    if (!flow) {
      const { name = 'Untitled', namespace = 'default', description = '', nodes = [], edges = [], workerId = '', artifacts = [] } = req.body;
      const owner = (req as any).user?.login || 'unknown';
      flow = { _id: req.params.id, name, namespace, description, nodes, edges, workerId, artifacts, owner, activeBranch: 'main', schedule: null, createdAt: now, updatedAt: now, lastExecution: null };
      await col.insert(flow);
    } else {
      const updates: any = { updatedAt: now };
      for (const key of ['name', 'namespace', 'description', 'nodes', 'edges', 'workerId', 'artifacts', 'owner']) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      await col.update({ _id: req.params.id }, { $set: updates });
      flow = await col.findOne({ _id: req.params.id });
    }
    // History now lives in git: commit the saved state onto the active branch.
    // commitFlowState is a no-op when the resulting tree is unchanged, so
    // repeated autosaves of identical content don't create empty commits.
    try {
      await commitFlowState(
        req.params.id,
        { login: (req as any).user?.login },
        `Save by ${(req as any).user?.login || 'unknown'}`,
        { allowAmend: true },
      );
    } catch (e: any) {
      console.warn('[flows] git commit on save failed:', e.message);
    }
    res.json(flow);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Force a commit of the flow's current persisted state right now (editor's
// "Save version" button). Returns the new commit, or 200 with unchanged=true.
router.post('/:id/versions', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const flow = await getCollection('flows').findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const login = (req as any).user?.login || 'unknown';
    const message = (req.body?.message as string) || `Manual checkpoint by ${login}`;
    const sha = await commitFlowState(req.params.id, { login }, message);
    if (!sha) return res.json({ unchanged: true });
    res.status(201).json({ _id: sha, savedAt: new Date().toISOString(), manual: true });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// History = git log of the active branch. Shape preserved for the existing UI
// (_id is the commit sha; savedAt/author/name retained).
router.get('/:id/versions', async (req: Request, res: Response) => {
  try {
    const flow = await getCollection('flows').findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const commits = await listCommits(req.params.id, activeRef(flow));
    res.json(commits.map((c) => ({
      _id: c.sha, flowId: req.params.id, savedAt: c.savedAt, author: c.author,
      name: flow.name, message: c.message,
    })));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/:id/versions/:vid', async (req: Request, res: Response) => {
  try {
    const fields = await flowFieldsAtCommit(req.params.id, req.params.vid);
    res.json({ _id: req.params.vid, flowId: req.params.id, ...fields });
  } catch (err: any) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: err.message } });
  }
});

router.post('/:id/versions/:vid/restore', requireFlowEditAccess, async (req: Request, res: Response) => {
  const now = new Date().toISOString();
  try {
    const col = getCollection('flows');
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    let fields;
    try {
      fields = await flowFieldsAtCommit(req.params.id, req.params.vid);
    } catch (e: any) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } }) as any;
    }
    await col.update({ _id: req.params.id }, { $set: {
      nodes: fields.nodes, edges: fields.edges, artifacts: fields.artifacts, updatedAt: now,
    } });
    // Record the restore as a new commit so it's itself part of history.
    const login = (req as any).user?.login || 'unknown';
    await commitFlowState(req.params.id, { login }, `Restore commit ${req.params.vid.slice(0, 8)} by ${login}`);
    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// List git branches for this flow.
router.get('/:id/branches', async (req: Request, res: Response) => {
  try {
    const flow = await getCollection('flows').findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const branches = await listBranches(req.params.id);
    res.json({ branches, active: flow.activeBranch || 'main' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Switch the active branch and materialize its HEAD into the flow doc — the
// executor runs whatever is currently in the doc.
router.post('/:id/branches/:name/checkout', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const updated = await checkoutBranchToDoc(req.params.id, req.params.name);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
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
    const user = (req as any).user;
    // Viewers are read-only — they must not be able to trigger executions.
    if (!user || (user.role !== 'admin' && user.role !== 'operator')) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only admins and operators can execute flows' } }) as any;
    }
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
    const schedulesCol = getCollection('schedules');
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const now = new Date().toISOString();
    await col.update({ _id: req.params.id }, { $set: { schedule: { cron, enabled, timezone }, updatedAt: now } });

    // Mirror into the schedules collection — that's what cronScheduler watches.
    // Without this the cron only fires after the next server restart (the
    // startup migration mirrors flow.schedule once). Upsert + (un)register now.
    let sched = await schedulesCol.findOne({ flowId: req.params.id, type: 'cron' });
    if (sched) {
      await schedulesCol.update({ _id: sched._id }, { $set: { cronExpr: cron, timezone, enabled, label: cron, updatedAt: now } });
      sched = { ...sched, cronExpr: cron, timezone, enabled };
    } else {
      sched = {
        _id: nowUid(), flowId: req.params.id, type: 'cron', cronExpr: cron, timezone,
        label: cron, enabled, createdBy: (req as any).user?._id || 'system', createdAt: now, updatedAt: now,
      };
      await schedulesCol.insert(sched);
    }
    unregisterCron(sched._id);
    if (enabled) registerCron(sched as any);

    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/:id/schedule', async (req: Request, res: Response) => {
  try {
    const col = getCollection('flows');
    const schedulesCol = getCollection('schedules');
    await col.update({ _id: req.params.id }, { $set: { schedule: null, updatedAt: new Date().toISOString() } });
    // Tear down the mirrored cron row + its registered node-cron task.
    const sched = await schedulesCol.findOne({ flowId: req.params.id, type: 'cron' });
    if (sched) {
      unregisterCron(sched._id);
      await schedulesCol.remove({ _id: sched._id });
    }
    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
