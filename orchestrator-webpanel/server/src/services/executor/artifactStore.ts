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

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Persist each artifact body once and return name->sha refs (order preserved).
export async function putArtifacts(artifacts: ArtifactInput[] | undefined): Promise<ArtifactRef[]> {
  if (!artifacts || !artifacts.length) return [];
  const col = getCollection('artifact_blobs');
  const mongo = isMongoMode();
  const refs: ArtifactRef[] = [];
  for (const a of artifacts) {
    const buf = Buffer.from(a.data ?? '', 'base64');
    const sha = sha256(buf);
    refs.push({ name: a.name, sha });
    // Immutable + content-addressed: skip if the blob already exists.
    if (await col.findOne({ _id: sha })) continue;
    await col.insert({
      _id: sha,
      data: mongo ? buf : buf.toString('base64'),
      size: buf.length,
      createdAt: new Date().toISOString(),
    });
  }
  return refs;
}

// Return one artifact body as base64 (the wire format the worker decodes), or
// null when the sha is unknown.
export async function getArtifactBase64(sha: string): Promise<string | null> {
  const doc = await getCollection('artifact_blobs').findOne({ _id: sha });
  if (!doc) return null;
  if (Buffer.isBuffer(doc.data)) return doc.data.toString('base64');
  // Mongo returns BinData as { buffer } / Binary; normalise defensively.
  if (doc.data && typeof doc.data === 'object' && typeof doc.data.buffer !== 'undefined') {
    return Buffer.from(doc.data.buffer).toString('base64');
  }
  return String(doc.data); // NeDB: already base64
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
  if (!blobs.length) return 0;
  const jobs: any[] = await jobsCol.find({}, { projection: { artifacts: 1 } });
  const referenced = new Set<string>();
  for (const j of jobs) {
    for (const ref of j.artifacts || []) {
      if (ref && typeof ref.sha === 'string') referenced.add(ref.sha);
    }
  }
  const cutoff = Date.now() - minAgeMs;
  let removed = 0;
  for (const b of blobs) {
    if (referenced.has(b._id)) continue;
    if (b.createdAt && new Date(b.createdAt).getTime() > cutoff) continue; // too fresh
    await blobsCol.remove({ _id: b._id });
    removed++;
  }
  return removed;
}
