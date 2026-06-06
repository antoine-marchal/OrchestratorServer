import { getCollection, isMongoMode } from '../db/index';
import type { GitObjectType } from './gitObjects';

// DB-backed git object/ref store, scoped per flow. Objects are content-addressed
// (sha) and immutable; refs are mutable pointers. On Mongo the bytes are stored
// as a native Buffer (BinData — no base64 inflation); on NeDB they're base64
// because NeDB cannot round-trip a Buffer cleanly (it JSON-serializes to
// {type:'Buffer',data:[...]}). Reads normalise either form back to a Buffer.

export interface StoredObject {
  objectType: GitObjectType;
  data: Buffer;
}

const objects = () => getCollection('git_objects');
const refs = () => getCollection('git_refs');

// Normalise a stored `data` field back to a Buffer regardless of how it was
// persisted: native Buffer (Mongo BinData), Mongo Binary ({buffer}), or base64
// string (NeDB, or legacy Mongo rows written before BinData).
function toBuffer(data: any): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data && typeof data === 'object' && typeof data.buffer !== 'undefined') return Buffer.from(data.buffer);
  return Buffer.from(String(data), 'base64');
}

export async function getObject(flowId: string, sha: string): Promise<StoredObject | null> {
  const doc = await objects().findOne({ _id: `${flowId}:${sha}` });
  if (!doc) return null;
  return { objectType: doc.objectType, data: toBuffer(doc.data) };
}

export async function hasObject(flowId: string, sha: string): Promise<boolean> {
  return !!(await objects().findOne({ _id: `${flowId}:${sha}` }));
}

export async function putObject(
  flowId: string,
  sha: string,
  objectType: GitObjectType,
  data: Buffer,
): Promise<void> {
  const _id = `${flowId}:${sha}`;
  if (await objects().findOne({ _id })) return; // immutable — skip duplicates
  await objects().insert({
    _id, flowId, sha, objectType,
    data: isMongoMode() ? data : data.toString('base64'),
  });
}

export interface RefRow {
  ref: string;
  sha: string;
}

export async function listRefs(flowId: string): Promise<RefRow[]> {
  const rows: any[] = await refs().find({ flowId });
  return rows.map((r) => ({ ref: r.ref, sha: r.sha }));
}

export async function getRef(flowId: string, ref: string): Promise<string | null> {
  const row = await refs().findOne({ _id: `${flowId}:${ref}` });
  return row ? row.sha : null;
}

export async function setRef(flowId: string, ref: string, sha: string): Promise<void> {
  const _id = `${flowId}:${ref}`;
  const existing = await refs().findOne({ _id });
  if (existing) {
    await refs().update({ _id }, { $set: { sha } });
  } else {
    await refs().insert({ _id, flowId, ref, sha });
  }
}

export async function deleteRef(flowId: string, ref: string): Promise<void> {
  await refs().remove({ _id: `${flowId}:${ref}` });
}

// Delete every object of this flow whose sha is NOT in `keep`. Used by the
// reachability GC after a history rewrite. Returns the count removed.
export async function deleteObjectsExcept(flowId: string, keep: Set<string>): Promise<number> {
  const rows: any[] = await objects().find({ flowId }, { projection: { _id: 1, sha: 1 } });
  let removed = 0;
  for (const r of rows) {
    if (keep.has(r.sha)) continue;
    await objects().remove({ _id: r._id });
    removed++;
  }
  return removed;
}
