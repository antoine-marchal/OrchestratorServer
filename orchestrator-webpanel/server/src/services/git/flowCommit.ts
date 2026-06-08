import { getCollection } from '../db/index';
import { buildCommit, parseCommit, parseTree } from './gitObjects';
import { flowToTree, treeToFlowFields, nodeContentSignature, readPreservedRootEntries, type NodeSignature, type FlowFields } from './flowMaterialize';
import {
  getObject,
  putObject,
  setRef,
  getRef,
  listRefs,
  deleteRef,
  deleteObjectsExcept,
  deleteAllRefs,
  getObjectType,
} from './gitStore';
import { putArtifacts, resolveRefs, gcArtifacts } from '../executor/artifactStore';
import type { ArtifactEntry } from './flowMaterialize';
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

  // Carry any user-added top-level files (e.g. a pushed .gitignore / docs) from
  // the current HEAD tree forward so this regenerated save doesn't erase them.
  const preserved = await readPreservedRootEntries(flowId, prevTree);
  // git stores the real artifact bytes (so clone gets the files). flow.artifacts
  // are content-addressed refs → resolve to {name,data} for the tree.
  const resolvedArtifacts = await resolveRefs(flow.artifacts);
  const { rootSha, objects } = flowToTree({ ...flow, artifacts: resolvedArtifacts }, preserved);
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

  // For UI autosaves, append a human-readable diff (vs the previous HEAD) to the
  // commit body, mirroring the VersionHistoryPanel diff view.
  let finalMessage = message;
  if (message.startsWith(AUTOSAVE_PREFIX)) {
    try {
      const summary = await diffSummary(flowId, prevTree, flow.nodes || [], flow.edges || []);
      if (summary) finalMessage = `${message}\n${summary}`;
    } catch { /* diff is best-effort — never block the commit */ }
  }

  const login = author.login || flow.owner || 'orchestrator';
  const commit = buildCommit({
    tree: rootSha,
    parents,
    authorName: login,
    authorEmail: `${login}@orchestrator.local`,
    message: finalMessage,
  });
  await putObject(flowId, commit.sha, commit.objectType, commit.data);
  await setRef(flowId, ref, commit.sha);
  return commit.sha;
}

// Snapshot a flow's current state for an execution record and return the commit
// sha the run should pin to. Executions used to embed a full copy of nodes+edges
// per run; instead we point them at an immutable git commit (objects are never
// GC'd) and reconstruct on demand. Returns null only if no commit could be made
// (e.g. flow missing) — caller then falls back to inlining the graph.
export async function snapshotFlowForExecution(flowId: string, author: CommitAuthor): Promise<string | null> {
  try {
    // No amend + a non-autosave message: never rewrites the user's editor
    // autosave, and commitFlowState returns null (no new commit) when the tree
    // is unchanged — the common case, since editing already commits.
    const sha = await commitFlowState(flowId, author, 'Snapshot for execution');
    if (sha) return sha;
    // Tree unchanged since last commit — pin to the current branch HEAD.
    const flow = await getCollection('flows').findOne({ _id: flowId });
    if (!flow) return null;
    return await getRef(flowId, activeRef(flow));
  } catch (e: any) {
    console.warn('[git] snapshotFlowForExecution failed:', e.message);
    return null;
  }
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

// Human-readable diff between the previous HEAD tree and the new node/edge graph,
// formatted like the VersionHistoryPanel diff. Empty string when nothing changed
// at the top level. Used as the body of UI autosave commits.
async function diffSummary(
  flowId: string,
  prevTree: string | null,
  currNodes: any[],
  currEdges: any[],
): Promise<string> {
  let prevNodes: any[] = [];
  let prevEdges: any[] = [];
  if (prevTree) {
    try {
      const f = await treeToFlowFields(flowId, prevTree);
      prevNodes = f.nodes || [];
      prevEdges = f.edges || [];
    } catch { /* unreadable prev tree → treat as empty */ }
  }

  const prevById = new Map(prevNodes.map((n) => [n.id, n]));
  const currById = new Map(currNodes.map((n) => [n.id, n]));
  const added: any[] = [];
  const changed: any[] = [];
  for (const [id, n] of currById) {
    if (!prevById.has(id)) added.push(n);
    else if (JSON.stringify(prevById.get(id)?.data ?? {}) !== JSON.stringify(n?.data ?? {})) changed.push(n);
  }
  const removed = prevNodes.filter((n) => !currById.has(n.id));

  const edgeKey = (e: any) => `${e.source}->${e.target}:${e.sourceHandle ?? ''}:${e.targetHandle ?? ''}`;
  const prevEK = new Set(prevEdges.map(edgeKey));
  const currEK = new Set(currEdges.map(edgeKey));
  const addedEdges = currEdges.filter((e) => !prevEK.has(edgeKey(e)));
  const removedEdges = prevEdges.filter((e) => !currEK.has(edgeKey(e)));

  const label = (n: any) => n?.data?.label || n.id;
  const type = (n: any) => n?.data?.type || 'node';
  const lines: string[] = [];
  if (added.length) { lines.push(`+ Added nodes (${added.length})`); for (const n of added) lines.push(`+ ${label(n)} [${type(n)}]`); }
  if (removed.length) { lines.push(`- Removed nodes (${removed.length})`); for (const n of removed) lines.push(`- ${label(n)} [${type(n)}]`); }
  if (changed.length) { lines.push(`~ Changed nodes (${changed.length})`); for (const n of changed) lines.push(`~ ${label(n)}`); }
  if (addedEdges.length) { lines.push(`+ Added edges (${addedEdges.length})`); for (const e of addedEdges) lines.push(`+ ${e.source} → ${e.target}`); }
  if (removedEdges.length) { lines.push(`- Removed edges (${removedEdges.length})`); for (const e of removedEdges) lines.push(`- ${e.source} → ${e.target}`); }
  return lines.join('\n');
}

// Normalize artifact entries to content-addressed {name,sha} refs. Ref entries
// (already carry a sha — the common case, since git now stores pointers) pass
// through untouched; any legacy inline {name,data} is stored into artifact_blobs
// and replaced with its ref. Never keeps base64 bodies around.
export async function ensureArtifactRefs(
  artifacts: ArtifactEntry[] | undefined,
): Promise<Array<{ name: string; sha: string }>> {
  const out: Array<{ name: string; sha: string }> = [];
  for (const a of artifacts || []) {
    if (!a || typeof a.name !== 'string') continue;
    if (typeof a.sha === 'string') { out.push({ name: a.name, sha: a.sha }); continue; }
    if (typeof a.data === 'string') {
      const [ref] = await putArtifacts([{ name: a.name, data: a.data }]);
      out.push(ref);
    }
  }
  return out;
}

// Convert git-materialized fields into the shape stored on the flow doc: artifact
// bodies live content-addressed in artifact_blobs, the doc carries only {name,sha}
// refs. Keeps fat base64 out of the flows collection on every checkout / restore
// / push-sync.
export async function fieldsToDoc(fields: FlowFields): Promise<any> {
  const refs = await ensureArtifactRefs(fields.artifacts);
  return { ...fields, artifacts: refs };
}

// Materialize a branch's HEAD into the flow document (executor reads the doc).
export async function checkoutBranchToDoc(flowId: string, branch: string): Promise<any> {
  const flows = getCollection('flows');
  const ref = branchRef(branch);
  const sha = await getRef(flowId, ref);
  if (!sha) throw new Error(`Branch ${branch} not found`);
  const fields = await fieldsToDoc(await flowFieldsAtCommit(flowId, sha));
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
  const fields = await fieldsToDoc(await flowFieldsAtCommit(flowId, sha));
  await flows.update({ _id: flowId }, { $set: { ...fields, updatedAt: new Date().toISOString() } });
}

// Create a new branch ref at `from` (a commit sha or existing branch name);
// defaults to the active branch's HEAD. Rejects duplicate / malformed names.
export async function createBranch(flowId: string, name: string, from?: string): Promise<string[]> {
  const clean = name.trim();
  if (!/^[A-Za-z0-9._\/-]+$/.test(clean) || clean.startsWith('/') || clean.endsWith('/') || clean.includes('..')) {
    throw new Error(`Invalid branch name: ${name}`);
  }
  const target = branchRef(clean);
  if (await getRef(flowId, target)) throw new Error(`Branch ${clean} already exists`);

  const flow = await getCollection('flows').findOne({ _id: flowId });
  if (!flow) throw new Error(`Flow ${flowId} not found`);
  await ensureInitialized(flowId);

  // Resolve `from`: explicit commit sha, an existing branch, or active HEAD.
  let sha: string | null = null;
  if (from) {
    const obj = await getObject(flowId, from);
    if (obj && obj.objectType === 'commit') sha = from;
    else sha = await getRef(flowId, branchRef(from));
  } else {
    sha = await getRef(flowId, activeRef(flow));
  }
  if (!sha) throw new Error(`Cannot resolve start point for branch ${clean}`);
  await setRef(flowId, target, sha);
  return listBranches(flowId);
}

// Delete a branch. Refuses the default branch and the flow's currently active
// branch (you'd be deleting the checkout out from under the executor). After
// removing the ref, GC reclaims any objects only that branch kept alive.
export async function deleteBranch(flowId: string, name: string): Promise<string[]> {
  const clean = name.trim();
  if (clean === DEFAULT_BRANCH) throw new Error(`Cannot delete the default branch "${DEFAULT_BRANCH}"`);

  const flow = await getCollection('flows').findOne({ _id: flowId });
  if (!flow) throw new Error(`Flow ${flowId} not found`);
  if (clean === activeBranchName(flow)) throw new Error(`Cannot delete the active branch "${clean}" — check out another branch first`);

  const ref = branchRef(clean);
  if (!(await getRef(flowId, ref))) throw new Error(`Branch ${clean} not found`);

  await deleteRef(flowId, ref);
  await gcFlowObjects(flowId);
  await gcArtifacts(0); // a branch-only artifact pointer may now be unreferenced
  return listBranches(flowId);
}

// Walk first-parent chain from `tip` down to (and including) `stop`. Returns the
// commits newest->oldest, or null if `stop` is not a first-parent ancestor.
async function firstParentPath(flowId: string, tip: string, stop: string): Promise<string[] | null> {
  const path: string[] = [];
  let sha: string | null = tip;
  const seen = new Set<string>();
  while (sha && !seen.has(sha)) {
    seen.add(sha);
    path.push(sha);
    if (sha === stop) return path;
    const c = await getCommit(flowId, sha);
    if (!c) break;
    sha = c.parents[0] || null;
  }
  return null;
}

export type ResetMode = 'head' | 'root';

// Rework the active branch around a selected commit, then GC unreachable objects.
//   mode 'head': git reset --hard — branch tip becomes `commit`, descendants dropped.
//   mode 'root': `commit` becomes the new root — ancestors dropped, descendants
//                rebuilt on top (their shas change). Result keeps commit..HEAD.
// Returns the new branch tip sha.
export async function resetBranch(
  flowId: string,
  branch: string,
  commit: string,
  mode: ResetMode,
): Promise<string> {
  const ref = branchRef(branch);
  const head = await getRef(flowId, ref);
  if (!head) throw new Error(`Branch ${branch} not found`);
  const target = await getCommit(flowId, commit);
  if (!target) throw new Error(`Commit ${commit} not found`);

  const path = await firstParentPath(flowId, head, commit); // [head, …, commit]
  if (!path) throw new Error(`Commit ${commit} is not on branch ${branch}`);

  let newTip: string;
  if (mode === 'head') {
    newTip = commit; // drop everything newer than `commit`
  } else {
    // Rebuild `commit` with no parents, then replay its descendants (path
    // entries newer than commit) onto the rewritten chain.
    const chain = path.slice().reverse(); // [commit, …, head], oldest->newest
    let parentSha: string | null = null;
    const rebuilt: string[] = [];
    for (const sha of chain) {
      const c = await getCommit(flowId, sha);
      if (!c) throw new Error(`Commit ${sha} not found during rebuild`);
      const author = c.author.match(/^(.*?)\s*<(.*?)>/);
      const built = buildCommit({
        tree: c.tree,
        parents: parentSha ? [parentSha] : [],
        authorName: author?.[1]?.trim() || 'orchestrator',
        authorEmail: author?.[2]?.trim() || 'orchestrator@orchestrator.local',
        message: c.message,
        when: c.authorDate ?? new Date(),
      });
      await putObject(flowId, built.sha, built.objectType, built.data);
      parentSha = built.sha;
      rebuilt.push(built.sha);
    }
    newTip = parentSha!;
  }

  await setRef(flowId, ref, newTip);
  await syncDocFromRefIfActive(flowId, ref);
  await gcFlowObjects(flowId);
  await gcArtifacts(0); // reclaim artifact blobs no surviving flow/job references
  return newTip;
}

// Delete ALL git state for a flow (objects + refs), then reclaim any artifact
// blobs that were kept alive only by this flow's commit pointers. Call when a
// flow is deleted — otherwise its git_objects linger and keep pinning artifacts.
export async function purgeFlowGit(flowId: string): Promise<void> {
  await deleteObjectsExcept(flowId, new Set()); // empty keep-set → delete every object
  await deleteAllRefs(flowId);
  await gcArtifacts(0); // pointers gone → unreferenced blobs/chunks reclaimable now
}

// Reachability GC: collect every git object reachable from any ref of this flow
// (commits -> trees -> subtrees/blobs), then delete the rest. Frees space after
// history rewrites. Scoped per flow — never touches another flow's objects.
export async function gcFlowObjects(flowId: string): Promise<number> {
  const refs = await listRefs(flowId);
  const reachable = new Set<string>();

  const walkTree = async (sha: string): Promise<void> => {
    if (reachable.has(sha)) return;
    reachable.add(sha);
    // Cheap type check first — never reassemble a large blob just to skip it.
    if (await getObjectType(flowId, sha) !== 'tree') return;
    const obj = await getObject(flowId, sha); // trees are small
    if (!obj) return;
    for (const e of parseTree(obj.data)) await walkTree(e.sha);
  };

  for (const r of refs) {
    let sha: string | null = r.sha;
    const seen = new Set<string>();
    while (sha && !seen.has(sha)) {
      seen.add(sha);
      if (reachable.has(sha)) break;
      reachable.add(sha);
      const c = await getCommit(flowId, sha);
      if (!c) break;
      await walkTree(c.tree);
      sha = c.parents[0] || null;
      for (const p of c.parents.slice(1)) {
        // Cover merge parents too (rare here, but keep GC correct).
        if (!reachable.has(p)) refs.push({ ref: '', sha: p });
      }
    }
  }
  return deleteObjectsExcept(flowId, reachable);
}

export async function listBranches(flowId: string): Promise<string[]> {
  const refs = await listRefs(flowId);
  return refs
    .filter((r) => r.ref.startsWith('refs/heads/'))
    .map((r) => r.ref.replace('refs/heads/', ''));
}
