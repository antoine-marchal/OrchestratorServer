import cron from 'node-cron';
import { flowRepository, scheduleRepository } from '../../data/repositories';
import { Schedule } from '../../data/models/Schedule';

type ExecuteOverrides = { workerId?: string | null; branch?: string };
type ExecuteFlowFn = (flowId: string, triggeredBy: string, triggeredUser?: string, overrides?: ExecuteOverrides) => Promise<string | null>;

const tasks = new Map<string, cron.ScheduledTask>();
let _executeFlow: ExecuteFlowFn | null = null;

export function setExecuteFlowFn(fn: ExecuteFlowFn): void {
  _executeFlow = fn;
}

export async function loadAll(): Promise<void> {
  try {
    const schedules = scheduleRepository;
    const all: Schedule[] = await schedules.find({ type: 'cron', enabled: true });
    for (const s of all) {
      register(s);
    }
    console.log(`[Cron] Loaded ${all.length} cron schedules`);
  } catch (err) {
    console.warn('[Cron] Could not load schedules (DB may not be ready):', (err as Error).message);
  }
}

export function register(schedule: Schedule): void {
  if (!schedule.cronExpr || !cron.validate(schedule.cronExpr)) {
    console.warn(`[Cron] Invalid cron expression for schedule ${schedule._id}: ${schedule.cronExpr}`);
    return;
  }

  // Unregister existing if any
  unregister(schedule._id);

  // node-cron defaults to server-local time; honour a stored timezone so a
  // schedule created with "America/New_York" fires in that zone, not UTC/local.
  const options = schedule.timezone ? { timezone: schedule.timezone } : undefined;
  const task = cron.schedule(schedule.cronExpr, async () => {
    if (!_executeFlow) return;
    console.log(`[Cron] Firing schedule ${schedule._id} for flow ${schedule.flowId}`);
    try {
      // Variant schedules carry a worker/branch override; flow-level ones don't.
      let ov: ExecuteOverrides | undefined;
      const variantId = (schedule as any).variantId;
      if (variantId) {
        // The subrow may have been deleted by someone who couldn't remove the
        // schedule row (schedule mgmt is admin-only). Skip rather than fire a
        // ghost run; best-effort unregister so it stops ticking.
        const flow = await flowRepository.findOne({ _id: schedule.flowId });
        const exists = flow && Array.isArray(flow.variants) && flow.variants.some((v: any) => v.id === variantId);
        if (!exists) { unregister(schedule._id); return; }
        ov = { workerId: (schedule as any).workerId ?? '', branch: (schedule as any).branch };
      }
      await _executeFlow(schedule.flowId, 'cron', undefined, ov);
      const schedules = scheduleRepository;
      await schedules.update({ _id: schedule._id }, { $set: { lastFiredAt: new Date().toISOString() } });
    } catch (err) {
      console.error(`[Cron] Error executing flow ${schedule.flowId}:`, (err as Error).message);
    }
  }, options);

  tasks.set(schedule._id, task);
}

export function unregister(scheduleId: string): void {
  const task = tasks.get(scheduleId);
  if (task) {
    task.stop();
    tasks.delete(scheduleId);
  }
}

export function unregisterAll(): void {
  for (const [id] of tasks) unregister(id);
}
