import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-art-'));
process.env.ORCHESTRATOR_WORK_DIR = TMP;
delete process.env.MONGO_URI;

import { connectDB, getCollection } from '../src/services/db/index';
import { commitFlowState, flowFieldsAtCommit, activeRef } from '../src/services/git/flowCommit';
import { getObject, getRef, putObject } from '../src/services/git/gitStore';
import { putArtifacts } from '../src/services/executor/artifactStore';
import { parseCommit, parseTree, buildBlob } from '../src/services/git/gitObjects';

beforeAll(async () => { await connectDB(); });

describe('git artifact blobs (real bytes for clone)', () => {
  it('stores the real artifact bytes as a git blob', async () => {
    const flowId = 'flow-art';
    const body = Buffer.alloc(4096, 7);
    const [ref] = await putArtifacts([{ name: 'data.bin', data: body.toString('base64') }]);

    await getCollection('flows').insert({
      _id: flowId, name: 'art', namespace: 'default', nodes: [{ id: 'n', data: { label: 'n', code: 'x', language: 'python' } }],
      edges: [], artifacts: [ref], activeBranch: 'main',
    });
    const commitSha = await commitFlowState(flowId, { login: 't' }, 'with artifact');

    const commit = parseCommit((await getObject(flowId, commitSha!))!.data);
    const root = parseTree((await getObject(flowId, commit.tree))!.data);
    const artDir = root.find(e => e.name === 'artifacts')!;
    const artTree = parseTree((await getObject(flowId, artDir.sha))!.data);
    const fileEntry = artTree.find(e => e.name === 'data.bin')!;
    const gitBlob = (await getObject(flowId, fileEntry.sha))!.data;

    // Real bytes — a clone gets the actual file, not a pointer.
    expect(gitBlob.equals(body)).toBe(true);
  });

  it('round-trips the commit back to an inline body', async () => {
    const flowId = 'flow-art';
    const sha = await getRef(flowId, activeRef({ activeBranch: 'main' }));
    const fields = await flowFieldsAtCommit(flowId, sha!);
    expect(fields.artifacts.length).toBe(1);
    expect(fields.artifacts[0].name).toBe('data.bin');
    expect(Buffer.from(fields.artifacts[0].data!, 'base64')).toEqual(Buffer.alloc(4096, 7));
  });

  it('chunks + reassembles a git object larger than 16MB', async () => {
    const flowId = 'flow-bigobj';
    const big = Buffer.alloc(20 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const blob = buildBlob(big);
    await putObject(flowId, blob.sha, blob.objectType, blob.data);

    // Manifest carries no inline data; chunk docs exist.
    const manifest = await getCollection('git_objects').findOne({ _id: `${flowId}:${blob.sha}` });
    expect(manifest.data == null).toBe(true);
    expect(manifest.chunks).toBeGreaterThan(1);

    const back = await getObject(flowId, blob.sha);
    expect(back!.data.equals(big)).toBe(true);
  });
});
