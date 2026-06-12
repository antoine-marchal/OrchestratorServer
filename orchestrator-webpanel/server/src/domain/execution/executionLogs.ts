import { gzipSync, gunzipSync } from 'zlib';
import { getCollection } from '../db/index';

// Execution logs used to live inline on the execution document, which made that
// doc grow without bound on chatty runs and bloated every full-doc read. They
// now live in their own collection, one doc per execution, fetched only when an
// execution's detail is opened. The executions list never carries them.
//
// Chatty runs (thousands of lines) made even this dedicated doc large and slow
// to serialize on both NeDB and Mongo. We now store the logs gzip-compressed:
// the array is JSON-stringified, gzipped, and kept as a base64 `gz` field with a
// plain `n` count. Log streams compress extremely well (repetitive timestamps,
// node ids, prefixes) — typically 10–20x smaller — which keeps the doc small,
// the write fast, and the read snappy. Legacy docs that still carry a raw `logs`
// array are read transparently and re-saved compressed on the next write.

interface LogDoc {
  _id: string;
  gz?: string;   // base64 gzip of JSON.stringify(logs)
  n?: number;    // log line count (cheap to read without inflating)
  logs?: any[];  // legacy uncompressed form
}

function encodeLogs(logs: any[]): { gz: string; n: number } {
  const gz = gzipSync(Buffer.from(JSON.stringify(logs), 'utf8')).toString('base64');
  return { gz, n: logs.length };
}

function decodeLogs(doc: LogDoc | null | undefined): any[] {
  if (!doc) return [];
  if (typeof doc.gz === 'string' && doc.gz.length) {
    try {
      const json = gunzipSync(Buffer.from(doc.gz, 'base64')).toString('utf8');
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  // Legacy: logs stored inline, uncompressed.
  return Array.isArray(doc.logs) ? doc.logs : [];
}

export async function saveExecutionLogs(execId: string, logs: any[]): Promise<void> {
  const col = getCollection('execution_logs');
  const { gz, n } = encodeLogs(Array.isArray(logs) ? logs : []);
  const existing = await col.findOne({ _id: execId });
  if (existing) {
    // Overwrite with the compressed form and drop any legacy `logs` array.
    await col.update({ _id: execId }, { $set: { gz, n }, $unset: { logs: true } });
  } else {
    await col.insert({ _id: execId, gz, n });
  }
}

export async function loadExecutionLogs(execId: string): Promise<any[]> {
  const doc = await getCollection('execution_logs').findOne({ _id: execId });
  return decodeLogs(doc as LogDoc);
}

export async function deleteExecutionLogs(execIds: string[]): Promise<void> {
  if (!execIds.length) return;
  await getCollection('execution_logs').remove({ _id: { $in: execIds } }, { multi: true });
}
