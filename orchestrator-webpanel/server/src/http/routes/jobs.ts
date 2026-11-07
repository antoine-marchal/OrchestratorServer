import { Router, Response } from 'express';
import type { Request } from '../request';
import { jobs, jobLogBuffers, jobLogListeners, processJob, terminateJobAndChildren, nowUid } from '../../domain/execution/nodeExecutor';
import { resolveSecretsDetailed } from '../../domain/secrets/secretService';
import { flowRepository } from '../../data/repositories';
import { resolveRefs } from '../../domain/execution/artifactStore';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const { type, code, codeFilePath, input, timeout, basePath, sessionId, runnerId, variables, workerId, artifacts, flowId } = req.body;
  if (!type) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Job type is required' } }) as any;

  // Artifacts are no longer shipped inline (base64) from the browser — the editor
  // sends the linked flowId and we resolve its content-addressed artifact refs to
  // bytes here. A caller may still pass inline `artifacts` (legacy); prefer those.
  let jobArtifacts: Array<{ name: string; data: string }> | undefined =
    Array.isArray(artifacts) && artifacts.length ? artifacts : undefined;
  if (!jobArtifacts && flowId) {
    const flow = await flowRepository.findOne({ _id: flowId });
    const resolved = await resolveRefs(flow?.artifacts);
    if (resolved.length) jobArtifacts = resolved;
  }

  // Resolve ${{ secrets.NAME }} placeholders only for jobs that run locally —
  // right before they're queued to execute. Worker-bound jobs keep the
  // placeholders intact; the worker fetches the decrypted values at execution
  // time (see /workers/:id/jobs/:jobId/secrets) so plaintext is never queued.
  let resolvedCode = code || '';
  if (!workerId && resolvedCode.includes('${{')) {
    // No workerId here means the job runs locally on the server — only the
    // global (and flow-scoped, when applicable) secrets apply.
    const { text } = await resolveSecretsDetailed(resolvedCode, {}, type);
    resolvedCode = text;
  }

  const jobId = nowUid();
  const job: any = {
    jobId, type, code: resolvedCode, codeFilePath, input, timeout, basePath, sessionId, runnerId,
    variables: variables || {}, workerId: workerId || null,
    artifacts: jobArtifacts,
    status: 'queued', startTime: new Date().toISOString(), stopRequested: false,
  };
  jobs.set(jobId, job);
  setTimeout(() => processJob(job), 0);

  res.status(202).json({ jobId, status: 'queued', estimatedStartTime: new Date(Date.now() + 100).toISOString(), queuePosition: 0 });
});

router.get('/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found' } }) as any;

  const allLogs = jobLogBuffers.get(req.params.jobId) || [];
  const startIndex = req.query.lastLogIndex ? parseInt(req.query.lastLogIndex as string, 10) : 0;

  res.json({
    jobId: job.jobId, status: job.status, output: job.output, error: job.error,
    log: job.log, executionTime: job.executionTime, startTime: job.startTime, endTime: job.endTime,
    variables: job.variables || {}, streamLogs: allLogs.slice(startIndex), totalLogCount: allLogs.length,
  });
});

router.post('/:jobId/stop', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found' } }) as any;
  if (['completed', 'failed', 'stopped'].includes(job.status)) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Job is not running' } }) as any;

  job.stopRequested = true;
  terminateJobAndChildren(req.params.jobId);
  job.status = 'stopped';
  res.json({ message: 'Job stop requested', jobId: req.params.jobId });
});

router.get('/:jobId/logs', (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const buffered = jobLogBuffers.get(jobId) || [];
  for (const entry of buffered) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  if (!jobLogListeners.has(jobId)) jobLogListeners.set(jobId, new Set());
  jobLogListeners.get(jobId)!.add(res);

  // Keep-alive comment so idle proxies don't drop the SSE connection.
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* client gone */ }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    const set = jobLogListeners.get(jobId);
    if (set) { set.delete(res); if (!set.size) jobLogListeners.delete(jobId); }
  });
});

export default router;
