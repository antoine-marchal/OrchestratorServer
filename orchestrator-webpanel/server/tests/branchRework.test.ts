import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Use an isolated NeDB store for these tests (connectDB picks NeDB when MONGO_URI
// is unset). Must be set before connectDB() touches the data dir.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-git-'));
process.env.ORCHESTRATOR_WORK_DIR = TMP;
delete process.env.MONGO_URI;

import { connectDB, getCollection } from '../src/services/db/index';
import { commitFlowState, listCommits, resetBranch, flowFieldsAtCommit, branchRef } from '../src/services/git/flowCommit';
import { getObject, getRef } from '../src/services/git/gitStore';

// Commit a flow with the given node count and return the new commit sha.
async function commitNodes(flowId: string, n: number): Promise<string> {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, data: { label: `Node ${i}`, code: `print ${i}`, language: 'python' } }));
  await getCollection('flows').update({ _id: flowId }, { $set: { nodes } });
  const sha = await commitFlowState(flowId, { login: 'tester' }, `commit ${n}`);
  if (!sha) throw new Error('expected a new commit');
  return sha;
}

async function makeFlow(id: string): Promise<string[]> {
  await getCollection('flows').insert({ _id: id, name: id, namespace: 'default', nodes: [], edges: [], artifacts: [], activeBranch: 'main' });
  // Build A -> B -> C -> D (oldest -> newest); returns [c1,c2,c3,c4].
  const c1 = await commitNodes(id, 1);
  const c2 = await commitNodes(id, 2);
  const c3 = await commitNodes(id, 3);
  const c4 = await commitNodes(id, 4);
  return [c1, c2, c3, c4];
}

beforeAll(async () => { await connectDB(); });

describe('resetBranch', () => {
  it("mode 'head' drops descendants and GCs them", async () => {
    const [c1, c2, c3, c4] = await makeFlow('flow-head');
    const tip = await resetBranch('flow-head', 'main', c2, 'head');
    expect(tip).toBe(c2);
    expect(await getRef('flow-head', branchRef('main'))).toBe(c2);

    const log = await listCommits('flow-head', branchRef('main'));
    expect(log.map(c => c.sha)).toEqual([c2, c1]);

    // Dropped commits are physically gone.
    expect(await getObject('flow-head', c3)).toBeNull();
    expect(await getObject('flow-head', c4)).toBeNull();
  });

  it("mode 'root' drops ancestors, replays descendants, GCs old chain", async () => {
    const [c1, c2, c3, c4] = await makeFlow('flow-root');
    const tip = await resetBranch('flow-root', 'main', c3, 'root');

    // History is now exactly two commits (rebuilt c3 + c4) with new shas.
    const log = await listCommits('flow-root', branchRef('main'));
    expect(log.length).toBe(2);
    expect(log[0].sha).toBe(tip);
    expect(log[1].parents).toEqual([]); // new root has no parent

    // Tip still carries the 4-node content from the old HEAD.
    const fields = await flowFieldsAtCommit('flow-root', tip);
    expect(fields.nodes.length).toBe(4);

    // Old ancestors c1/c2 and the original c3/c4 are reclaimed.
    expect(await getObject('flow-root', c1)).toBeNull();
    expect(await getObject('flow-root', c2)).toBeNull();
    expect(await getObject('flow-root', c4)).toBeNull();
  });

  it('rejects a commit not on the branch', async () => {
    await makeFlow('flow-bad');
    await expect(resetBranch('flow-bad', 'main', 'deadbeef'.repeat(5), 'head')).rejects.toThrow();
  });
});
