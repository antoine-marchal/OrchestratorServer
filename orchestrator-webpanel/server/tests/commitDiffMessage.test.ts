import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-msg-'));
process.env.ORCHESTRATOR_WORK_DIR = TMP;
delete process.env.MONGO_URI;

import { connectDB, getCollection } from '../src/services/db/index';
import { commitFlowState, listCommits, activeRef } from '../src/services/git/flowCommit';

beforeAll(async () => { await connectDB(); });

describe('autosave commit message diff', () => {
  it("appends a node/edge diff under 'Save by'", async () => {
    const id = 'flow-msg';
    await getCollection('flows').insert({ _id: id, name: id, nodes: [], edges: [], artifacts: [], activeBranch: 'main' });

    // First save: one node added.
    await getCollection('flows').update({ _id: id }, { $set: { nodes: [{ id: 'n1', data: { label: 'Batch', type: 'batch', code: 'echo 1' } }] } });
    await commitFlowState(id, { login: 'amarchal' }, 'Save by amarchal');

    // Second save: another node + an edge.
    await getCollection('flows').update({ _id: id }, { $set: {
      nodes: [
        { id: 'n1', data: { label: 'Batch', type: 'batch', code: 'echo 1' } },
        { id: 'n2', data: { label: 'Py', type: 'python', code: 'print(2)' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    } });
    await commitFlowState(id, { login: 'amarchal' }, 'Save by amarchal');

    const log = await listCommits(id, activeRef({ activeBranch: 'main' }));
    const latest = log[0].message;
    expect(latest.startsWith('Save by amarchal')).toBe(true);
    expect(latest).toContain('+ Added nodes (1)');
    expect(latest).toContain('Py [python]');
    expect(latest).toContain('+ Added edges (1)');
    expect(latest).toContain('n1 → n2');
  });
});
