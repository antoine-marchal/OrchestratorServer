// One long-poll round: fetch pending jobs, ack and dispatch each to the job
// runner. In 'sequential' execution mode, jobs from a different flow than the
// one currently in flight are left pending until this worker goes idle. The
// retry/backoff loop lives in the entrypoint (agent.ts); this throws on transport
// errors so that loop can back off or re-register.
import { http } from './transport/httpClient';
import { EXECUTION_MODE, POLL_HTTP_TIMEOUT_MS } from './config';
import { executeJob } from './jobs/jobRunner';

// Sequential-mode bookkeeping: the flow execution id we're currently bound to
// and how many of its jobs are still running. When the count drops to 0 the
// worker is free to bind to whichever flow's job arrives next.
let activeExecutionId: string | null = null;
let runningJobs = 0;

export async function poll(workerId: string): Promise<void> {
  try {
    const res = await http.get(`/api/v1/workers/${workerId}/jobs`, { timeout: POLL_HTTP_TIMEOUT_MS });
    const jobs: any[] = res.data.jobs || [];
    for (const job of jobs) {
      if (
        EXECUTION_MODE === 'sequential' &&
        activeExecutionId !== null &&
        job.executionId !== activeExecutionId
      ) {
        continue; // leave it pending — a later poll picks it up once we're idle
      }
      if (activeExecutionId === null) activeExecutionId = job.executionId ?? null;
      runningJobs++;
      await http.post(`/api/v1/workers/${workerId}/jobs/${job._id}/ack`).catch(() => {});
      executeJob(workerId, job)
        .catch(console.error)
        .finally(() => {
          runningJobs--;
          if (runningJobs === 0) activeExecutionId = null;
        });
    }
  } catch (e: any) {
    if (e.code !== 'ECONNREFUSED' && e.code !== 'ETIMEDOUT') {
      console.error('[worker] poll error:', e.message);
    }
    throw e; // surface to the poll loop so it can back off / re-register
  }
}
