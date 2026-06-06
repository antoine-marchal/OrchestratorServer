import crypto from 'crypto';
import { getCollection, isMongoMode } from '../db/index';

// Content-addressed artifact store. A flow's file attachments used to be inlined
// (base64) into every worker_job — one full copy per dispatched node, never
// reclaimed. Here each distinct artifact body is stored ONCE under its sha256;
// worker_jobs carry only `{ name, sha }` refs. Dedups across nodes in a run and
// across runs with identical content. Bytes are kept as a Buffer on Mongo
// (BinData — no base64 inflation) and as base64 on NeDB (which can't round-trip
// a Buffer cleanly). GC reclaims blobs no live worker_job references.

export interface ArtifactRef { name: string; sha: string; }
export interface ArtifactInput { name: string; data: string; } // data = base64

// MongoDB caps a single BSON document at 16 MB, so a large artifact can't live in
// one blob doc (insert throws "offset is out of bounds"). Split bodies over this
// threshold into chunk docs in artifact_chunks and keep a manifest in
// artifact_blobs. 8 MB raw → ~8 MB BinData, comfortably under the 16 MB cap.
const CHUNK_BYTES = 8 * 1024 * 1024;

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Normalise a stored data field (native Buffer, Mongo Binary {buffer}, or NeDB
// base64 string) to a Buffer.
function toBuffer(data: any): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data && typeof data === 'object' && typeof data.buffer !== 'undefined') return Buffer.from(data.buffer);
  return Buffer.from(String(data), 'base64');
}

// Persist each artifact body once and return name->sha refs (order preserved).
export async function putArtifacts(artifacts: ArtifactInput[] | undefined): Promise<ArtifactRef[]> {
  if (!artifacts || !artifacts.length) return [];
  const col = getCollection('artifact_blobs');
  const chunkCol = getCollection('artifact_chunks');
  const mongo = isMongoMode();
  const enc = (b: Buffer) => (mongo ? b : b.toString('base64'));
  const refs: ArtifactRef[] = [];
  for (const a of artifacts) {
    const buf = Buffer.from(a.data ?? '', 'base64');
    const sha = sha256(buf);
    refs.push({ name: a.name, sha });
    // Immutable + content-addressed: skip if the blob already exists.
    if (await col.findOne({ _id: sha })) continue;
    const createdAt = new Date().toISOString();
    if (buf.length <= CHUNK_BYTES) {
      // Small: keep the body inline on the manifest (chunks:0), as before.
      await col.insert({ _id: sha, data: enc(buf), size: buf.length, chunks: 0, createdAt });
    } else {
      const n = Math.ceil(buf.length / CHUNK_BYTES);
      for (let i = 0; i < n; i++) {
        const part = Buffer.from(buf.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
        // createdAt lets GC skip chunks still mid-write (inserted before manifest).
        await chunkCol.insert({ _id: `${sha}:${i}`, sha, idx: i, data: enc(part), createdAt });
      }
      // Manifest carries no inline data; readers reassemble from chunks.
      await col.insert({ _id: sha, size: buf.length, chunks: n, createdAt });
    }
  }
  return refs;
}

// Resolve name->sha refs back to the inline {name, data(base64)} shape the
// executor and git materializer consume. Missing blobs are skipped (logged).
export async function resolveRefs(
  refs: Array<{ name: string; sha?: string; data?: string }> | undefined,
): Promise<Array<{ name: string; data: string }>> {
  if (!refs || !refs.length) return [];
  const out: Array<{ name: string; data: string }> = [];
  for (const r of refs) {
    if (!r || typeof r.name !== 'string') continue;
    // Tolerate legacy inline artifacts (carry their own base64 data) so a
    // half-migrated flow still resolves.
    if (typeof r.data === 'string' && !r.sha) { out.push({ name: r.name, data: r.data }); continue; }
    if (!r.sha) continue;
    const data = await getArtifactBase64(r.sha);
    if (data == null) { console.warn(`[artifact] blob ${r.sha} (${r.name}) missing`); continue; }
    out.push({ name: r.name, data });
  }
  return out;
}

// Return one artifact body as base64 (the wire format the worker decodes), or
// null when the sha is unknown.
export async function getArtifactBase64(sha: string): Promise<string | null> {
  const doc = await getCollection('artifact_blobs').findOne({ _id: sha });
  if (!doc) return null;
  // Inline (small / legacy single-doc) body.
  if (doc.data !== undefined && doc.data !== null) return toBuffer(doc.data).toString('base64');
  // Chunked: reassemble in order.
  const n = doc.chunks || 0;
  if (!n) return null;
  const chunkCol = getCollection('artifact_chunks');
  const parts: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const c = await chunkCol.findOne({ _id: `${sha}:${i}` });
    if (!c) { console.warn(`[artifact] blob ${sha} missing chunk ${i}/${n}`); return null; }
    parts.push(toBuffer(c.data));
  }
  return Buffer.concat(parts).toString('base64');
}

// Byte length of a stored artifact (manifest `size`), or null if unknown.
export async function getArtifactSize(sha: string): Promise<number | null> {
  const doc = await getCollection('artifact_blobs').findOne({ _id: sha });
  if (!doc) return null;
  if (typeof doc.size === 'number') return doc.size;
  return doc.data != null ? toBuffer(doc.data).length : 0;
}

// Stream an artifact body one chunk (Buffer) at a time — never materializes the
// whole file in memory. Backs the streamed download endpoint.
export async function* artifactChunks(sha: string): AsyncGenerator<Buffer, void, unknown> {
  const doc = await getCollection('artifact_blobs').findOne({ _id: sha });
  if (!doc) return;
  if (doc.data !== undefined && doc.data !== null) { yield toBuffer(doc.data); return; }
  const n = doc.chunks || 0;
  const chunkCol = getCollection('artifact_chunks');
  for (let i = 0; i < n; i++) {
    const c = await chunkCol.findOne({ _id: `${sha}:${i}` });
    if (!c) { console.warn(`[artifact] blob ${sha} missing chunk ${i}/${n}`); return; }
    yield toBuffer(c.data);
  }
}

// Delete blobs not referenced by any worker_job. Cheap-ish: one scan of
// worker_jobs artifact refs, then remove the complement. Called by the periodic
// sweep after stale worker_jobs are pruned. `minAgeMs` skips freshly-written
// blobs so we never reclaim one in the window between putArtifacts() inserting
// the blob and dispatchToWorker() inserting the referencing worker_job.
export async function gcArtifacts(minAgeMs = 600000): Promise<number> {
  const blobsCol = getCollection('artifact_blobs');
  const jobsCol = getCollection('worker_jobs');
  const blobs: any[] = await blobsCol.find({}, { projection: { _id: 1, createdAt: 1 } });
  const jobs: any[] = await jobsCol.find({}, { projection: { artifacts: 1 } });
  const referenced = new Set<string>();
  for (const j of jobs) {
    for (const ref of j.artifacts || []) {
      if (ref && typeof ref.sha === 'string') referenced.add(ref.sha);
    }
  }
  // Flows now reference artifact blobs by sha too (flow.artifacts = [{name,sha}]).
  // Without this scan the janitor would reclaim every flow's artifacts.
  const flows: any[] = await getCollection('flows').find({}, { projection: { artifacts: 1 } });
  for (const f of flows) {
    for (const ref of f.artifacts || []) {
      if (ref && typeof ref.sha === 'string') referenced.add(ref.sha);
    }
  }
  // Git stores artifacts as pointers (sha256) rather than duplicating the bytes,
  // so any commit's pointer — including historical commits whose flow doc no
  // longer lists the artifact — keeps its blob alive.
  const { collectArtifactPointerShas } = await import('../git/gitStore');
  for (const sha of await collectArtifactPointerShas()) referenced.add(sha);
  const cutoff = Date.now() - minAgeMs;
  const chunkCol = getCollection('artifact_chunks');
  let removed = 0;
  for (const b of blobs) {
    if (referenced.has(b._id)) continue;
    if (b.createdAt && new Date(b.createdAt).getTime() > cutoff) continue; // too fresh
    await blobsCol.remove({ _id: b._id });
    await chunkCol.remove({ sha: b._id }, { multi: true }); // reclaim any chunks
    removed++;
  }

  // Dangling-chunk sweep: chunks whose manifest no longer exists (crashed/partial
  // write, or a manifest deleted without its chunks). Skip chunks younger than the
  // cutoff so an in-flight upload (chunks inserted before its manifest) is safe.
  const liveShas = new Set<string>((await blobsCol.find({}, { projection: { _id: 1 } })).map((b: any) => b._id));
  const chunks: any[] = await chunkCol.find({}, { projection: { _id: 1, sha: 1, createdAt: 1 } });
  for (const c of chunks) {
    if (liveShas.has(c.sha)) continue;
    if (c.createdAt && new Date(c.createdAt).getTime() > cutoff) continue; // mid-upload
    await chunkCol.remove({ _id: c._id });
  }
  return removed;
}
