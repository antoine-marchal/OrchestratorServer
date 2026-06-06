import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-del-'));
process.env.ORCHESTRATOR_WORK_DIR = TMP;
delete process.env.MONGO_URI;

import { connectDB, getCollection } from '../src/services/db/index';
import { commitFlowState, purgeFlowGit } from '../src/services/git/flowCommit';
import { putArtifacts, getArtifactBase64 } from '../src/services/executor/artifactStore';

beforeAll(async () => { await connectDB(); });

describe('flow delete cascade (purgeFlowGit)', () => {
  it('drops git objects/refs/chunks and reclaims orphaned artifact blobs', async () => {
    const id = 'flow-del';
    // 20MB → chunked in BOTH git_object_chunks and artifact_chunks.
    const [ref] = await putArtifacts([{ name: 'a.bin', data: Buffer.alloc(20 * 1024 * 1024, 5).toString('base64') }]);
    await getCollection('flows').insert({
      _id: id, name: id, nodes: [{ id: 'n', data: { label: 'n', code: 'x', language: 'python' } }],
      edges: [], artifacts: [ref], activeBranch: 'main',
    });
    await commitFlowState(id, { login: 't' }, 'init');

    expect((await getCollection('git_objects').find({ flowId: id })).length).toBeGreaterThan(0);
    expect((await getCollection('git_object_chunks').find({})).length).toBeGreaterThan(0);
    expect((await getCollection('git_refs').find({ flowId: id })).length).toBeGreaterThan(0);
    expect(await getArtifactBase64(ref.sha)).not.toBeNull();

    // Mimic the DELETE route: remove the flow doc, then cascade.
    await getCollection('flows').remove({ _id: id });
    await purgeFlowGit(id);

    expect((await getCollection('git_objects').find({ flowId: id })).length).toBe(0);
    expect((await getCollection('git_object_chunks').find({})).length).toBe(0);
    expect((await getCollection('git_refs').find({ flowId: id })).length).toBe(0);
    // No flow / pointer / job references it anymore → reclaimed.
    expect(await getArtifactBase64(ref.sha)).toBeNull();
    expect(await getCollection('artifact_chunks').count({ sha: ref.sha })).toBe(0);
  });
});
