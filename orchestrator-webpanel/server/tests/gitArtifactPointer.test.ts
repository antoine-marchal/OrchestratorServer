import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-art-'));
process.env.ORCHESTRATOR_WORK_DIR = TMP;
delete process.env.MONGO_URI;

import { connectDB, getCollection } from '../src/services/db/index';
import { commitFlowState, flowFieldsAtCommit, activeRef } from '../src/services/git/flowCommit';
import { getObject, getRef } from '../src/services/git/gitStore';
import { putArtifacts, resolveRefs } from '../src/services/executor/artifactStore';
import { parseCommit, parseTree } from '../src/services/git/gitObjects';

beforeAll(async () => { await connectDB(); });

describe('git artifact pointers (no byte duplication)', () => {
  it('stores a pointer in git, bytes only in artifact_blobs', async () => {
    const flowId = 'flow-art';
    // 4 KB body so a pointer is obviously smaller than the bytes.
    const body = Buffer.alloc(4096, 7);
    const [ref] = await putArtifacts([{ name: 'data.bin', data: body.toString('base64') }]);
    expect(ref.sha).toMatch(/^[a-f0-9]{64}$/);

    await getCollection('flows').insert({
      _id: flowId, name: 'art', namespace: 'default', nodes: [{ id: 'n', data: { label: 'n', code: 'x', language: 'python' } }],
      edges: [], artifacts: [ref], activeBranch: 'main',
    });
    const commitSha = await commitFlowState(flowId, { login: 't' }, 'with artifact');
    expect(commitSha).toBeTruthy();

    // Walk commit -> tree -> artifacts/ -> data.bin blob.
    const commit = parseCommit((await getObject(flowId, commitSha!))!.data);
    const root = parseTree((await getObject(flowId, commit.tree))!.data);
    const artDir = root.find(e => e.name === 'artifacts');
    expect(artDir).toBeTruthy();
    const artTree = parseTree((await getObject(flowId, artDir!.sha))!.data);
    const fileEntry = artTree.find(e => e.name === 'data.bin');
    expect(fileEntry).toBeTruthy();
    const gitBlob = (await getObject(flowId, fileEntry!.sha))!.data;

    // The git blob is a pointer, NOT the 4 KB body.
    expect(gitBlob.length).toBeLessThan(128);
    expect(gitBlob.toString('utf8')).toContain(`sha256:${ref.sha}`);
  });

  it('round-trips back to the ref and resolves to original bytes', async () => {
    const flowId = 'flow-art';
    const sha = await getRef(flowId, activeRef({ activeBranch: 'main' }));
    const fields = await flowFieldsAtCommit(flowId, sha!);
    expect(fields.artifacts).toEqual([{ name: 'data.bin', sha: expect.stringMatching(/^[a-f0-9]{64}$/) }]);

    const [resolved] = await resolveRefs(fields.artifacts);
    expect(Buffer.from(resolved.data, 'base64')).toEqual(Buffer.alloc(4096, 7));
  });
});
