import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-chunk-'));
process.env.ORCHESTRATOR_WORK_DIR = TMP;
delete process.env.MONGO_URI;

import { connectDB, getCollection } from '../src/data/db/index';
import { putArtifacts, getArtifactBase64, gcArtifacts } from '../src/domain/execution/artifactStore';

beforeAll(async () => { await connectDB(); });

describe('artifact chunking', () => {
  it('round-trips a body larger than one chunk (>8MB)', async () => {
    // 20 MB of varied bytes so chunk boundaries matter.
    const body = Buffer.alloc(20 * 1024 * 1024);
    for (let i = 0; i < body.length; i++) body[i] = i % 251;
    const [ref] = await putArtifacts([{ name: 'big.bin', data: body.toString('base64') }]);

    // Manifest carries no inline data; chunks recorded.
    const manifest = await getCollection('artifact_blobs').findOne({ _id: ref.sha });
    expect(manifest.data == null).toBe(true);
    expect(manifest.chunks).toBe(Math.ceil(body.length / (8 * 1024 * 1024)));
    const chunkCount = await getCollection('artifact_chunks').count({ sha: ref.sha });
    expect(chunkCount).toBe(manifest.chunks);

    const out = await getArtifactBase64(ref.sha);
    expect(Buffer.from(out!, 'base64').equals(body)).toBe(true);
  });

  it('GC reclaims chunks of an unreferenced blob', async () => {
    const body = Buffer.alloc(20 * 1024 * 1024, 9);
    const [ref] = await putArtifacts([{ name: 'orphan.bin', data: body.toString('base64') }]);
    // No flow / job / pointer references it → reclaimable. minAgeMs=0 to bypass freshness.
    const removed = await gcArtifacts(0);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await getArtifactBase64(ref.sha)).toBeNull();
    expect(await getCollection('artifact_chunks').count({ sha: ref.sha })).toBe(0);
  });

  it('prunes dangling chunks whose manifest is gone', async () => {
    const body = Buffer.alloc(20 * 1024 * 1024, 3);
    const [ref] = await putArtifacts([{ name: 'd.bin', data: body.toString('base64') }]);
    // Simulate a crash between chunk writes and manifest insert.
    await getCollection('artifact_blobs').remove({ _id: ref.sha });
    expect(await getCollection('artifact_chunks').count({ sha: ref.sha })).toBeGreaterThan(0);
    await gcArtifacts(0);
    expect(await getCollection('artifact_chunks').count({ sha: ref.sha })).toBe(0);
  });
});
