import { Router, Request, Response } from 'express';
import { getCollection } from '../services/db/index';
import { jobs, jobLogBuffers, terminateJobAndChildren, executionSSEListeners, executionNodeStatuses } from '../services/executor/nodeExecutor';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const col = getCollection('executions');
    const query: any = {};
    if (req.query.flowId) query.flowId = req.query.flowId;
    if (req.query.status) query.status = req.query.status;
    if (req.query.since) {
      const since = new Date(req.query.since as string);
      if (isNaN(since.getTime())) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid "since" date' } }) as any;
      }
      query.startTime = { $gt: since.toISOString() };
    }

    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 500);
    const offset = Math.max(parseInt((req.query.offset as string) || '0', 10) || 0, 0);

    // DB-level sort + skip + limit — uses the (flowId, startTime) index on
    // Mongo. NeDB still scans but at least doesn't materialise every doc
    // through this Node process before slicing.
    const [page, total] = await Promise.all([
      col.find(query, { sort: { startTime: -1 }, skip: offset, limit }),
      col.count(query),
    ]);

    // For still-running executions, the persisted `logs` field on the DB row
    // is empty — logs only get written at completion. Merge the live in-memory
    // buffer here so the client's tab-level sync poll doesn't see [] and
    // overwrite logs that the per-execution poller has already pulled in.
    for (const e of page) {
      if (e.status === 'RUNNING' && e.jobId) {
        const buf = jobLogBuffers.get(e.jobId);
        if (Array.isArray(buf) && buf.length > 0) e.logs = buf;
      }
    }

    res.json({ executions: page, total });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Bulk clear (all executions, or all for one flow). Destructive and global —
// admins only. Operators/viewers must delete executions individually via
// DELETE /:id (operators only their own).
router.delete('/', async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only admins can clear execution history' } }) as any;
    }
    const execsCol = getCollection('executions');
    const flowsCol = getCollection('flows');
    const flowId = req.query.flowId ? String(req.query.flowId) : null;

    const query = flowId ? { flowId } : {};
    const toDelete = await execsCol.find(query);

    for (const exec of toDelete) {
      if (exec.jobId) jobLogBuffers.delete(exec.jobId);
    }

    const removed = await execsCol.remove(query, { multi: true });

    if (flowId) {
      await flowsCol.update({ _id: flowId }, { $set: { lastExecution: null } });
    } else {
      await flowsCol.update({}, { $set: { lastExecution: null } }, { multi: true });
    }

    res.json({ deleted: removed });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Delete a single execution. Admins may delete any; operators may delete only
// executions they themselves triggered (exec.triggeredUser === their login);
// viewers may delete none. Cron/api/event runs have triggeredUser=null, so only
// an admin can remove those.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const execsCol = getCollection('executions');
    const flowsCol = getCollection('flows');
    const exec = await execsCol.findOne({ _id: req.params.id });
    if (!exec) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Execution not found' } }) as any;

    const role = req.user?.role;
    const isAdmin = role === 'admin';
    const isAuthor = !!req.user?.login && exec.triggeredUser === req.user.login;
    if (!isAdmin && !(role === 'operator' && isAuthor)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete executions you triggered' } }) as any;
    }

    // Don't yank a running execution out from under the executor — kill first.
    if (exec.status === 'RUNNING') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Cannot delete a running execution — kill it first' } }) as any;
    }

    if (exec.jobId) jobLogBuffers.delete(exec.jobId);
    await execsCol.remove({ _id: exec._id });

    // If the flow's lastExecution pointer referenced this row, repoint it to the
    // most recent surviving execution for that flow (or null when none remain).
    const flow = await flowsCol.findOne({ _id: exec.flowId });
    if (flow && flow.lastExecution && flow.lastExecution.id === exec._id) {
      const [latest] = await execsCol.find({ flowId: exec.flowId }, { sort: { startTime: -1 }, limit: 1 });
      const lastExecution = latest
        ? { id: latest._id, status: latest.status, startTime: latest.startTime, endTime: latest.endTime, duration: latest.duration }
        : null;
      await flowsCol.update({ _id: exec.flowId }, { $set: { lastExecution } });
    }

    res.json({ deleted: 1 });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const execsCol = getCollection('executions');
    const flowsCol = getCollection('flows');
    let exec = await execsCol.findOne({ _id: req.params.id });
    if (!exec) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Execution not found' } }) as any;

    if (exec.status === 'RUNNING' && exec.jobId) {
      const j = jobs.get(exec.jobId);
      if (j) {
        exec.logs = jobLogBuffers.get(exec.jobId) || [];
        if (['completed', 'failed', 'stopped'].includes(j.status)) {
          const endTime = new Date().toISOString();
          const status = j.status === 'completed' ? 'SUCCESS' : j.status === 'stopped' ? 'KILLED' : 'FAILED';
          const updates = { status, endTime, duration: new Date(endTime).getTime() - new Date(exec.startTime).getTime(), output: j.output, error: j.error };
          await execsCol.update({ _id: req.params.id }, { $set: updates });
          exec = { ...exec, ...updates };
          await flowsCol.update({ _id: exec.flowId }, { $set: { lastExecution: { id: exec._id, status, startTime: exec.startTime, endTime, duration: updates.duration } } });
        }
      } else {
        // No in-memory job — server restarted while it was running, or the
        // job record was already drained. Reconcile to FAILED so the UI
        // stops polling instead of spinning forever.
        const endTime = new Date().toISOString();
        const duration = new Date(endTime).getTime() - new Date(exec.startTime).getTime();
        const updates = { status: 'FAILED', endTime, duration, error: 'Execution lost: server restarted while running' };
        await execsCol.update({ _id: req.params.id }, { $set: updates });
        exec = { ...exec, ...updates };
        await flowsCol.update({ _id: exec.flowId }, { $set: { lastExecution: { id: exec._id, status: 'FAILED', startTime: exec.startTime, endTime, duration } } });
      }
    }
    res.json(exec);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const col = getCollection('executions');
    const exec = await col.findOne({ _id: req.params.id });
    if (!exec) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Execution not found' } }) as any;

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'displayName')) {
      const displayName = String(req.body.displayName || '').trim();
      if (displayName) {
        await col.update({ _id: req.params.id }, { $set: { displayName: displayName.slice(0, 160) } });
      } else {
        await col.update({ _id: req.params.id }, { $unset: { displayName: true } });
      }
    }

    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/:id/kill', async (req: Request, res: Response) => {
  try {
    const execsCol = getCollection('executions');
    const flowsCol = getCollection('flows');
    const exec = await execsCol.findOne({ _id: req.params.id });
    if (!exec) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Execution not found' } }) as any;
    if (exec.status !== 'RUNNING') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Execution is not running' } }) as any;

    if (exec.jobId) {
      const j = jobs.get(exec.jobId);
      if (j) { j.stopRequested = true; terminateJobAndChildren(exec.jobId); }
    }

    const endTime = new Date().toISOString();
    const duration = new Date(endTime).getTime() - new Date(exec.startTime).getTime();
    await execsCol.update({ _id: req.params.id }, { $set: { status: 'KILLED', endTime, duration } });
    await flowsCol.update({ _id: exec.flowId }, { $set: { lastExecution: { id: exec._id, status: 'KILLED', startTime: exec.startTime, endTime, duration } } });

    res.json({ message: 'Execution killed', execution: await execsCol.findOne({ _id: req.params.id }) });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// SSE stream for per-node execution status.
// The executor emits on jobId (see flowExecutor.ts emitNodeStatus calls), so register
// the listener under both execId and the exec's jobId so events reach the browser.
// On connect, replay every node's last known status — first from the in-memory
// buffer (live or recently-completed runs), then from the persisted execution
// record (older runs). This is what lets the user flip between executions
// without losing the overlay state.
router.get('/:id/stream', async (req: Request, res: Response) => {
  const execId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let jobId: string | null = null;
  let persistedStatuses: Record<string, any> | null = null;
  try {
    const exec = await getCollection('executions').findOne({ _id: execId });
    jobId = exec?.jobId || null;
    if (exec && exec.nodeStatuses && typeof exec.nodeStatuses === 'object') {
      persistedStatuses = exec.nodeStatuses;
    }
  } catch { /* exec lookup non-fatal */ }

  // Prefer the in-memory buffer (latest truth) over the DB snapshot.
  const liveStatuses = executionNodeStatuses.get(execId)
    ?? (jobId ? executionNodeStatuses.get(jobId) : undefined)
    ?? persistedStatuses;
  if (liveStatuses) {
    for (const payload of Object.values(liveStatuses)) {
      try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* client gone */ }
    }
  }

  const keys = [execId, ...(jobId ? [jobId] : [])];
  for (const k of keys) {
    if (!executionSSEListeners.has(k)) executionSSEListeners.set(k, new Set());
    executionSSEListeners.get(k)!.add(res);
  }

  // Keep-alive: idle proxies/load balancers drop long-lived SSE connections.
  // A comment frame every 20s keeps the pipe warm without affecting the client.
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* client gone */ }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    for (const k of keys) {
      const set = executionSSEListeners.get(k);
      if (set) { set.delete(res); if (!set.size) executionSSEListeners.delete(k); }
    }
  });
});

export default router;
