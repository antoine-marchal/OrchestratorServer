import { getCollection, isMongoMode } from '../../data/db/index';
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
const objectChunks = () => getCollection('git_object_chunks');
const refs = () => getCollection('git_refs');

// Git objects (incl. artifact blobs, which now carry real bytes so `git clone`
// gets the files) can exceed MongoDB's 16MB BSON document cap. Split large
// objects into chunk docs in git_object_chunks; the manifest in git_objects then
// records `chunks:n` and readers reassemble. 8MB raw → ~8MB BinData, under 16MB.
const GIT_CHUNK_BYTES = 8 * 1024 * 1024;

// Two commits racing (e.g. an editor autosave overlapping a manual save) can
// both pass an existence check and then both insert the same content-addressed
// _id, and the loser throws a unique-constraint error ("it violates the unique
// constraint" on NeDB, code 11000 / E11000 on Mongo). Git objects are immutable
// and content-addressed, so a duplicate insert is a no-op — swallow it.
function isDuplicateKeyError(err: any): boolean {
  if (!err) return false;
  if (err.code === 11000 || err.errorType === 'uniqueViolated') return true;
  const msg = String(err.message || err);
  return /unique constraint|E11000|duplicate key/i.test(msg);
}

async function insertIgnoreDuplicate(col: { insert: (doc: any) => Promise<any> }, doc: any): Promise<void> {
  try {
    await col.insert(doc);
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // Same object already persisted by a concurrent writer — immutable, so fine.
  }
}

// Normalise a stored `data` field back to a Buffer regardless of how it was
// persisted: native Buffer (Mongo BinData), Mongo Binary ({buffer}), or base64
// string (NeDB, or legacy Mongo rows written before BinData).
function toBuffer(data: any): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data && typeof data === 'object' && typeof data.buffer !== 'undefined') return Buffer.from(data.buffer);
  return Buffer.from(String(data), 'base64');
}

export async function getObject(flowId: string, sha: string): Promise<StoredObject | null> {
  const _id = `${flowId}:${sha}`;
  const doc = await objects().findOne({ _id });
  if (!doc) return null;
  if (doc.data !== undefined && doc.data !== null) return { objectType: doc.objectType, data: toBuffer(doc.data) };
  // Chunked: reassemble in order.
  const n = doc.chunks || 0;
  const parts: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const c = await objectChunks().findOne({ _id: `${_id}:${i}` });
    if (!c) throw new Error(`git object ${_id} missing chunk ${i}/${n}`);
    parts.push(toBuffer(c.data));
  }
  return { objectType: doc.objectType, data: Buffer.concat(parts) };
}

export async function hasObject(flowId: string, sha: string): Promise<boolean> {
  return !!(await objects().findOne({ _id: `${flowId}:${sha}` }));
}

// Read just the object's type from its manifest — no chunk reassembly. Lets the
// reachability GC skip recursing into (and loading) large blobs.
export async function getObjectType(flowId: string, sha: string): Promise<GitObjectType | null> {
  const doc = await objects().findOne({ _id: `${flowId}:${sha}` });
  return doc ? doc.objectType : null;
}

export async function putObject(
  flowId: string,
  sha: string,
  objectType: GitObjectType,
  data: Buffer,
): Promise<void> {
  const _id = `${flowId}:${sha}`;
  if (await objects().findOne({ _id })) return; // immutable — skip duplicates
  const mongo = isMongoMode();
  const enc = (b: Buffer) => (mongo ? b : b.toString('base64'));
  if (data.length <= GIT_CHUNK_BYTES) {
    await insertIgnoreDuplicate(objects(), { _id, flowId, sha, objectType, data: enc(data), chunks: 0 });
  } else {
    const n = Math.ceil(data.length / GIT_CHUNK_BYTES);
    for (let i = 0; i < n; i++) {
      const part = Buffer.from(data.subarray(i * GIT_CHUNK_BYTES, (i + 1) * GIT_CHUNK_BYTES));
      await insertIgnoreDuplicate(objectChunks(), { _id: `${_id}:${i}`, key: _id, idx: i, data: enc(part) });
    }
    await insertIgnoreDuplicate(objects(), { _id, flowId, sha, objectType, chunks: n });
  }
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
    // Race-safe: if a concurrent writer created the ref between our findOne and
    // here, fall back to updating it instead of crashing on the duplicate _id.
    try {
      await refs().insert({ _id, flowId, ref, sha });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      await refs().update({ _id }, { $set: { sha } });
    }
  }
}

export async function deleteRef(flowId: string, ref: string): Promise<void> {
  await refs().remove({ _id: `${flowId}:${ref}` });
}

// Remove every ref of a flow (used when the flow is deleted).
export async function deleteAllRefs(flowId: string): Promise<number> {
  return refs().remove({ flowId }, { multi: true });
}

// Every artifact-pointer sha256 referenced by ANY git blob across ALL flows.
// Artifact bodies (in artifact_blobs) must survive as long as a commit anywhere
// still points at them — even commits whose flow doc no longer lists the
// artifact — so the janitor consults this before reclaiming a blob.
const POINTER_TAG = 'orchestrator.artifact/v1';
export async function collectArtifactPointerShas(): Promise<Set<string>> {
  const out = new Set<string>();
  const rows: any[] = await objects().find({ objectType: 'blob' });
  for (const r of rows) {
    if (r.data == null) continue; // chunked (large) → not a tiny pointer blob
    // Pointer blobs are tiny; skip anything too large to be one cheaply.
    const buf = toBuffer(r.data);
    if (buf.length > 256) continue;
    const text = buf.toString('utf8');
    if (!text.startsWith(POINTER_TAG)) continue;
    const m = text.match(/sha256:([a-f0-9]+)/);
    if (m) out.add(m[1]);
  }
  return out;
}

// Delete every object of this flow whose sha is NOT in `keep`. Used by the
// reachability GC after a history rewrite. Returns the count removed.
export async function deleteObjectsExcept(flowId: string, keep: Set<string>): Promise<number> {
  const rows: any[] = await objects().find({ flowId }, { projection: { _id: 1, sha: 1 } });
  let removed = 0;
  for (const r of rows) {
    if (keep.has(r.sha)) continue;
    await objects().remove({ _id: r._id });
    await objectChunks().remove({ key: r._id }, { multi: true }); // reclaim chunks
    removed++;
  }
  return removed;
}
