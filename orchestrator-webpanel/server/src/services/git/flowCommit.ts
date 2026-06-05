import { getCollection } from '../db/index';
import { buildCommit, parseCommit } from './gitObjects';
import { flowToTree, treeToFlowFields, nodeContentSignature, type NodeSignature } from './flowMaterialize';
import {
  getObject,
  putObject,
  setRef,
  getRef,
  listRefs,
} from './gitStore';
import type { BuiltObject } from './gitObjects';

export const DEFAULT_BRANCH = 'main';

export function branchRef(name: string): string {
  return name.startsWith('refs/') ? name : `refs/heads/${name}`;
}

export function activeBranchName(flow: any): string {
  return flow?.activeBranch || DEFAULT_BRANCH;
}

export function activeRef(flow: any): string {
  return branchRef(activeBranchName(flow));
}

async function persistObjects(flowId: string, objects: BuiltObject[]): Promise<void> {
  for (const o of objects) await putObject(flowId, o.sha, o.objectType, o.data);
}

export interface CommitAuthor {
  login?: string;
}

async function getCommit(flowId: string, sha: string | null) {
  if (!sha) return null;
  const obj = await getObject(flowId, sha);
  if (!obj || obj.objectType !== 'commit') return null;
  return parseCommit(obj.data);
}

// Top-level change classification between two tree signatures.
interface Change { added: string[]; removed: string[]; codeChanged: string[] }

function classify(prev: NodeSignature, next: NodeSignature): Change {
  const prevIds = new Set(prev.ids);
  const nextIds = new Set(next.ids);
  const added = next.ids.filter((id) => !prevIds.has(id));
  const removed = prev.ids.filter((id) => !nextIds.has(id));
  const codeChanged = next.ids.filter(
    (id) => prevIds.has(id) && prev.shas.get(id) !== next.shas.get(id),
  );
  return { added, removed, codeChanged };
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0');

// Decide whether this save should amend HEAD or create a new commit. Compares
// git trees (formatting-invariant), not reconstructed docs.
//   - node added/removed                              -> new commit
//   - only minor edits (positions, edges, labels, …)  -> amend HEAD
//   - node content changed                            -> new commit, UNLESS the
//     exact same node(s) were the content change in the last commit (a
//     continuing editing session on one node) -> amend HEAD
// Marker prefix on UI autosave commits. Amend only ever rewrites one of these —
// a commit from another source (git push, manual checkpoint, restore, initial
// import) is never touched.
export const AUTOSAVE_PREFIX = 'Save by ';

async function decideAmend(flowId: string, headCommit: any, newRootSha: string): Promise<boolean> {
  // Never amend a commit that didn't come from a UI autosave.
  if (!String(headCommit.message || '').startsWith(AUTOSAVE_PREFIX)) return false;
  const headSig = await nodeContentSignature(flowId, headCommit.tree);
  const newSig = await nodeContentSignature(flowId, newRootSha);
  const c = classify(headSig, newSig);
  if (c.added.length || c.removed.length) return false;
  if (c.codeChanged.length === 0) return true; // minor only
  const parentSha = headCommit.parents?.[0];
  if (!parentSha) return false; // no prior commit to compare against
  const parentCommit = await getCommit(flowId, parentSha);
  if (!parentCommit) return false;
  const parentSig = await nodeContentSignature(flowId, parentCommit.tree);
  const last = classify(parentSig, headSig);
  if (last.added.length || last.removed.length) return false; // last commit was structural
  return sameSet(c.codeChanged, last.codeChanged);
}

export interface CommitOptions {
  // When true, fold this save into the previous commit if the change is minor or
  // continues editing the same node's content (see decideAmend). Used by autosave.
  allowAmend?: boolean;
}

// Snapshot the flow's current persisted state as a commit on its active branch.
// Returns the new commit sha, or null when the tree is unchanged (no-op save).
export async function commitFlowState(
  flowId: string,
  author: CommitAuthor,
  message: string,
  options: CommitOptions = {},
): Promise<string | null> {
  const flows = getCollection('flows');
  const flow = await flows.findOne({ _id: flowId });
  if (!flow) throw new Error(`Flow ${flowId} not found`);

  const ref = activeRef(flow);
  const headSha = await getRef(flowId, ref);
  const headCommit = await getCommit(flowId, headSha);
  const prevTree = headCommit?.tree ?? null;

  const { rootSha, objects } = flowToTree(flow);
  if (rootSha === prevTree) return null; // nothing changed

  await persistObjects(flowId, objects);

  // Default: new commit on top of HEAD. Amend = reuse HEAD's parents, replacing it.
  let parents = headSha ? [headSha] : [];
  if (options.allowAmend && headCommit && headSha) {
    try {
      if (await decideAmend(flowId, headCommit, rootSha)) parents = headCommit.parents || [];
    } catch (e: any) {
      console.warn('[git] amend decision failed, creating new commit:', e.message);
    }
  }

  const login = author.login || flow.owner || 'orchestrator';
  const commit = buildCommit({
    tree: rootSha,
    parents,
    authorName: login,
    authorEmail: `${login}@orchestrator.local`,
    message,
  });
  await putObject(flowId, commit.sha, commit.objectType, commit.data);
  await setRef(flowId, ref, commit.sha);
  return commit.sha;
}

// Create the first commit from the current flow doc if the repo is empty.
// Lets `git clone` work for flows that predate git history.
export async function ensureInitialized(flowId: string): Promise<void> {
  const refs = await listRefs(flowId);
  if (refs.length > 0) return;
  const flow = await getCollection('flows').findOne({ _id: flowId });
  if (!flow) return;
  await commitFlowState(flowId, { login: flow.owner }, 'Initial import from Orchestrator');
}

export interface CommitLogEntry {
  sha: string;
  author: string;
  message: string;
  savedAt: string;
  parents: string[];
}

// Walk first-parent history from a branch ref.
export async function listCommits(
  flowId: string,
  ref: string,
  limit = 200,
): Promise<CommitLogEntry[]> {
  const out: CommitLogEntry[] = [];
  let sha = await getRef(flowId, ref);
  const seen = new Set<string>();
  while (sha && !seen.has(sha) && out.length < limit) {
    seen.add(sha);
    const obj = await getObject(flowId, sha);
    if (!obj || obj.objectType !== 'commit') break;
    const c = parseCommit(obj.data);
    out.push({
      sha,
      author: (c.author.split('<')[0] || '').trim(),
      message: c.message,
      savedAt: (c.authorDate ?? new Date(0)).toISOString(),
      parents: c.parents,
    });
    sha = c.parents[0] || null;
  }
  return out;
}

// Reconstruct the flow fields captured by a specific commit.
export async function flowFieldsAtCommit(flowId: string, commitSha: string) {
  const obj = await getObject(flowId, commitSha);
  if (!obj || obj.objectType !== 'commit') throw new Error(`Commit ${commitSha} not found`);
  const c = parseCommit(obj.data);
  return treeToFlowFields(flowId, c.tree);
}

// Materialize a branch's HEAD into the flow document (executor reads the doc).
export async function checkoutBranchToDoc(flowId: string, branch: string): Promise<any> {
  const flows = getCollection('flows');
  const ref = branchRef(branch);
  const sha = await getRef(flowId, ref);
  if (!sha) throw new Error(`Branch ${branch} not found`);
  const fields = await flowFieldsAtCommit(flowId, sha);
  const now = new Date().toISOString();
  await flows.update(
    { _id: flowId },
    { $set: { ...fields, activeBranch: branch.replace(/^refs\/heads\//, ''), updatedAt: now } },
  );
  return flows.findOne({ _id: flowId });
}

// After a push updates a branch ref, sync the doc if that branch is active.
export async function syncDocFromRefIfActive(flowId: string, ref: string): Promise<void> {
  const flows = getCollection('flows');
  const flow = await flows.findOne({ _id: flowId });
  if (!flow) return;
  if (branchRef(activeBranchName(flow)) !== ref) return;
  const sha = await getRef(flowId, ref);
  if (!sha) return;
  const fields = await flowFieldsAtCommit(flowId, sha);
  await flows.update({ _id: flowId }, { $set: { ...fields, updatedAt: new Date().toISOString() } });
}

export async function listBranches(flowId: string): Promise<string[]> {
  const refs = await listRefs(flowId);
  return refs
    .filter((r) => r.ref.startsWith('refs/heads/'))
    .map((r) => r.ref.replace('refs/heads/', ''));
}
