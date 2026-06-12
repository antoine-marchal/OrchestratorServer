// Worker lifecycle against the orchestrator: registration (mints a per-worker
// token), heartbeat, and graceful deregistration.
import { http } from './transport/httpClient';
import { WORKER_NAME, WORKER_SECRET } from './config';

export async function register(): Promise<{ workerId: string; token: string }> {
  const res = await http.post('/api/v1/workers/register', {
    name: WORKER_NAME,
    secret: WORKER_SECRET,
    platform: process.platform,   // 'win32' | 'linux' | 'darwin'
  });
  return { workerId: res.data.workerId, token: res.data.token || '' };
}

export async function sendHeartbeat(workerId: string): Promise<void> {
  try { await http.post(`/api/v1/workers/${workerId}/heartbeat`); } catch { /* ignore */ }
}

export async function deregister(workerId: string): Promise<void> {
  try { await http.delete(`/api/v1/workers/${workerId}`); } catch { /* ignore */ }
}
