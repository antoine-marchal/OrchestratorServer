import { getCollection } from '../db/index';

// Execution logs used to live inline on the execution document, which made that
// doc grow without bound on chatty runs and bloated every full-doc read. They
// now live in their own collection, one doc per execution, fetched only when an
// execution's detail is opened. The executions list never carries them.

export async function saveExecutionLogs(execId: string, logs: any[]): Promise<void> {
  const col = getCollection('execution_logs');
  const existing = await col.findOne({ _id: execId });
  if (existing) {
    await col.update({ _id: execId }, { $set: { logs } });
  } else {
    await col.insert({ _id: execId, logs });
  }
}

export async function loadExecutionLogs(execId: string): Promise<any[]> {
  const doc = await getCollection('execution_logs').findOne({ _id: execId });
  return Array.isArray(doc?.logs) ? doc!.logs : [];
}

export async function deleteExecutionLogs(execIds: string[]): Promise<void> {
  if (!execIds.length) return;
  await getCollection('execution_logs').remove({ _id: { $in: execIds } }, { multi: true });
}
