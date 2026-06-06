import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os'; import path from 'path'; import fs from 'fs';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-push-'));
process.env.ORCHESTRATOR_WORK_DIR = TMP; delete process.env.MONGO_URI;
import { connectDB, getCollection } from '../src/services/db/index';
import { commitFlowState, syncDocFromRefIfActive, activeRef, branchRef } from '../src/services/git/flowCommit';
import { putArtifacts, getArtifactBase64, resolveRefs } from '../src/services/executor/artifactStore';

beforeAll(async () => { await connectDB(); });

describe('push ingest re-populates artifact store from git real bytes', () => {
  it('syncDocFromRefIfActive restores blob + flow.artifacts', async () => {
    const id = 'flow-push';
    const body = Buffer.alloc(2048, 9);
    const [ref] = await putArtifacts([{ name: 'pushed.bin', data: body.toString('base64') }]);
    await getCollection('flows').insert({ _id: id, name: id, nodes: [], edges: [], artifacts: [ref], activeBranch: 'main' });
    await commitFlowState(id, { login: 't' }, 'init');

    // Simulate a fresh push: the blob isn't in artifact_blobs (only in git), and
    // the doc doesn't list it yet.
    await getCollection('artifact_blobs').remove({ _id: ref.sha });
    await getCollection('flows').update({ _id: id }, { $set: { artifacts: [] } });
    expect(await getArtifactBase64(ref.sha)).toBeNull();

    await syncDocFromRefIfActive(id, branchRef('main'));

    const flow = await getCollection('flows').findOne({ _id: id });
    expect(flow.artifacts.length).toBe(1);
    expect(flow.artifacts[0].name).toBe('pushed.bin');
    const [resolved] = await resolveRefs(flow.artifacts);
    expect(Buffer.from(resolved.data, 'base64').equals(body)).toBe(true);
  });
});
