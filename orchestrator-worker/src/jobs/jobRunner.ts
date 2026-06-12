// Runs one worker job end-to-end: report running → ensure artifacts → resolve
// secrets → execute the node via its runtime → report completion/failure, with
// logs streamed back to the orchestrator throughout.
import { http } from '../transport/httpClient';
import { WORKER_NAME, EXECUTION_DIR } from '../config';
import { executeNode } from '../runtimes';
import { resolveSecrets } from './secrets';
import { ensureArtifactsExtracted, markExecNodeStart, markExecNodeEnd } from './artifacts';

export async function executeJob(workerId: string, job: any): Promise<void> {
  const jobId = job._id;
  const artifactRefs: Array<{name: string; sha?: string; data?: string}> = job.artifacts || [];
  // Artifacts are extracted once per flow execution and shared across its nodes
  // (see artifacts.ts). Fall back to the jobId when a job has no executionId so
  // a stray node still gets its own cleanup bucket.
  const execKey: string = job.executionId || jobId;
  const hasArtifacts = artifactRefs.length > 0;
  const onLog = (type: 'log' | 'error', message: string) => {
    http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/log`, { type, message }).catch(() => {});
  };
  try {
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/status`, { status: 'running' });
    onLog('log', `[worker] running ${job.node?.type ?? 'node'} on "${WORKER_NAME}" (${process.platform}, cwd=${EXECUTION_DIR})`);

    if (hasArtifacts) {
      await ensureArtifactsExtracted(workerId, jobId, execKey, artifactRefs, onLog);
      markExecNodeStart(execKey);
    }

    if (job.node?.data) {
      job.node.data.code = await resolveSecrets(workerId, jobId, job.node.data.code || '', onLog, job.node?.type);
    }
    const result = await executeNode(job.node, onLog);
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/complete`, {
      output: result.output, variables: result.variables, status: 'success',
    });
    console.log(`[worker] Job ${jobId} completed`);
  } catch (err: any) {
    onLog('error', `[worker] ${err.message}`);
    await http.post(`/api/v1/workers/${workerId}/jobs/${jobId}/complete`, {
      status: 'failed', error: err.message,
    }).catch(() => {});
    console.error(`[worker] Job ${jobId} failed:`, err.message);
  } finally {
    if (hasArtifacts) markExecNodeEnd(execKey);
  }
}
