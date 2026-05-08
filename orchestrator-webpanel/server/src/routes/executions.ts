import { Router, Request, Response } from 'express';
import { getCollection } from '../services/db/index';
import { jobs, jobLogBuffers, terminateJobAndChildren, executionSSEListeners, executionNodeStatuses } from '../services/executor/nodeExecutor';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const col = getCollection('executions');
    let query: any = {};
    if (req.query.flowId) query.flowId = req.query.flowId;
    if (req.query.status) query.status = req.query.status;
    let execs = await col.find(query);
    if (req.query.since) { const since = new Date(req.query.since as string); execs = execs.filter((e: any) => new Date(e.startTime) > since); }
    execs.sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const page = execs.slice(offset, offset + limit);

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

    res.json({ executions: page, total: execs.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/', async (req: Request, res: Response) => {
  try {
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

  req.on('close', () => {
    for (const k of keys) {
      const set = executionSSEListeners.get(k);
      if (set) { set.delete(res); if (!set.size) executionSSEListeners.delete(k); }
    }
  });
});

export default router;
