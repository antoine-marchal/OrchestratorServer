import cron from 'node-cron';
import { getCollection } from '../db/index';
import { Schedule } from '../db/models/Schedule';

type ExecuteFlowFn = (flowId: string, triggeredBy: string) => Promise<string | null>;

const tasks = new Map<string, cron.ScheduledTask>();
let _executeFlow: ExecuteFlowFn | null = null;

export function setExecuteFlowFn(fn: ExecuteFlowFn): void {
  _executeFlow = fn;
}

export async function loadAll(): Promise<void> {
  try {
    const schedules = getCollection('schedules');
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
      await _executeFlow(schedule.flowId, 'cron');
      const schedules = getCollection('schedules');
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
