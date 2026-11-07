import express, { Router, Response, NextFunction } from 'express';
import type { Request } from '../request';
import { flowRepository, scheduleRepository, userRepository, workerRepository } from '../../data/repositories';
import { nowUid } from '../../domain/execution/nodeExecutor';
import { executeOrchestratorFlow } from '../../domain/execution/flowExecutor';
import { register as registerCron, unregister as unregisterCron } from '../../infra/scheduler/cronScheduler';
import { canUserUseWorker } from '../../domain/workers/workerService';
import {
  commitFlowState,
  listCommits,
  flowFieldsAtCommit,
  listBranches,
  checkoutBranchToDoc,
  createBranch,
  deleteBranch,
  resetBranch,
  ensureArtifactRefs,
  purgeFlowGit,
  activeRef,
  activeBranchName,
  type ResetMode,
} from '../../infra/git/flowCommit';
import { listExtraEntries, resolveExtraPath } from '../../infra/git/flowMaterialize';
import { getRef, getObject } from '../../infra/git/gitStore';
import { parseCommit } from '../../infra/git/gitObjects';
import { putArtifacts, getArtifactBase64, getArtifactSize, artifactChunks } from '../../domain/execution/artifactStore';

// Resolve a flow's active-branch HEAD tree sha (null when the repo has no commit).
async function activeHeadTreeSha(flowId: string, flow: any): Promise<string | null> {
  const sha = await getRef(flowId, activeRef(flow));
  if (!sha) return null;
  const obj = await getObject(flowId, sha);
  if (!obj || obj.objectType !== 'commit') return null;
  return parseCommit(obj.data).tree;
}

// A file is treated as binary (download-only, no in-editor view) if it carries a
// NUL byte in its first 8KB — the same cheap heuristic git uses.
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Cap the in-editor text view; larger files are download-only.
const EXTRA_VIEW_MAX_BYTES = 2 * 1024 * 1024;

const router = Router();

// Raw binary body parser for artifact uploads. Artifacts used to ride inside the
// flow PUT as base64 inside JSON, which blew the V8 string limit on large files
// ("allocation size overflow") regardless of JSON_BODY_LIMIT. Uploading the raw
// bytes sidesteps base64 inflation and the JSON parser entirely.
const rawArtifact = express.raw({ type: () => true, limit: process.env.ARTIFACT_UPLOAD_LIMIT || '1024mb' });

// Operators can edit any flow whose owner is either themselves or another
// operator. They cannot edit admin-owned flows. Admins can edit anything.
async function canUserEditFlow(user: any, flow: any): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'operator') return false;
  const ownerLogin = flow?.owner;
  if (!ownerLogin) return true; // legacy unowned: treat as operator-editable
  if (ownerLogin === user.login) return true;
  const usersCol = userRepository;
  const owner = await usersCol.findOne({ login: ownerLogin });
  // Owner missing/deleted → treat as operator (don't trap edits to nobody).
  if (!owner) return true;
  return owner.role !== 'admin';
}

// Reject owner assignments that target a viewer (or a missing user). Returns
// the error string when invalid, null when OK.
async function validateOwnerLogin(login: string | undefined): Promise<string | null> {
  if (!login) return null; // no change requested
  const owner = await userRepository.findOne({ login });
  if (!owner) return `Owner '${login}' is not a known user`;
  if (owner.role === 'viewer') return `Owner '${login}' is a viewer — viewers cannot own flows`;
  return null;
}

async function requireFlowEditAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as any).user;
  if (!user) { res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }); return; }
  if (user.role !== 'admin' && user.role !== 'operator') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only admins and operators can edit flows' } });
    return;
  }
  const flow = await flowRepository.findOne({ _id: req.params.id });
  // Missing flow on PUT means upsert (create) — admins and operators may
  // create. On DELETE the caller will hit a 404 inside the handler itself.
  if (!flow) { next(); return; }
  const ok = await canUserEditFlow(user, flow);
  if (!ok) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot edit a flow owned by an admin' } }); return; }
  next();
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const col = flowRepository;
    const flows = await col.find({});
    flows.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ flows, total: flows.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const { name, namespace = 'default', description = '', nodes = [], edges = [], workerId = '' } = req.body;
  if (!name) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name is required' } }) as any;
  const now = new Date().toISOString();
  const owner = (req as any).user?.login || 'unknown';
  const flow = { _id: nowUid(), name, namespace, description, nodes, edges, workerId, owner, schedule: null, createdAt: now, updatedAt: now, lastExecution: null };
  try {
    const col = flowRepository;
    await col.insert(flow);
    res.status(201).json(flow);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const col = flowRepository;
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    res.json(flow);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.put('/:id', requireFlowEditAccess, async (req: Request, res: Response) => {
  const now = new Date().toISOString();
  try {
    const ownerError = await validateOwnerLogin(req.body?.owner);
    if (ownerError) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: ownerError } }) as any;
    // Don't let a user assign a worker they're forbidden from — selecting a
    // worker in a flow requires access to it (see canUserUseWorker).
    if (req.body?.workerId) {
      const worker = await workerRepository.findOne({ _id: req.body.workerId });
      if (worker && !canUserUseWorker((req as any).user, worker)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: `You are not allowed to use worker "${worker.name}"` } }) as any;
      }
    }
    // Normalize artifacts to content-addressed {name,sha} refs. Callers may send
    // refs (the editor) or inline {name,data} (an imported .or file / legacy);
    // either way we never store base64 bodies on the flow doc.
    if (req.body.artifacts !== undefined) {
      const incoming = Array.isArray(req.body.artifacts) ? req.body.artifacts : [];
      const refs: Array<{ name: string; sha: string }> = [];
      for (const a of incoming) {
        if (!a || typeof a.name !== 'string') continue;
        if (typeof a.sha === 'string') { refs.push({ name: a.name, sha: a.sha }); continue; }
        const [ref] = await putArtifacts([{ name: a.name, data: a.data ?? '' }]);
        refs.push(ref);
      }
      req.body.artifacts = refs;
    }
    const col = flowRepository;
    let flow = await col.findOne({ _id: req.params.id });
    if (!flow) {
      const { name = 'Untitled', namespace = 'default', description = '', nodes = [], edges = [], workerId = '', artifacts = [] } = req.body;
      const owner = (req as any).user?.login || 'unknown';
      flow = { _id: req.params.id, name, namespace, description, nodes, edges, workerId, artifacts, owner, activeBranch: 'main', schedule: null, createdAt: now, updatedAt: now, lastExecution: null };
      await col.insert(flow);
    } else {
      const updates: any = { updatedAt: now };
      for (const key of ['name', 'namespace', 'description', 'nodes', 'edges', 'workerId', 'artifacts', 'owner', 'variants']) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      await col.update({ _id: req.params.id }, { $set: updates });
      flow = await col.findOne({ _id: req.params.id });
    }
    // History now lives in git: commit the saved state onto the active branch.
    // commitFlowState is a no-op when the resulting tree is unchanged, so
    // repeated autosaves of identical content don't create empty commits.
    try {
      await commitFlowState(
        req.params.id,
        { login: (req as any).user?.login },
        `Save by ${(req as any).user?.login || 'unknown'}`,
        { allowAmend: true },
      );
    } catch (e: any) {
      console.warn('[flows] git commit on save failed:', e.message);
    }
    res.json(flow);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Force a commit of the flow's current persisted state right now (editor's
// "Save version" button). Returns the new commit, or 200 with unchanged=true.
router.post('/:id/versions', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const login = (req as any).user?.login || 'unknown';
    const message = (req.body?.message as string) || `Manual checkpoint by ${login}`;
    const sha = await commitFlowState(req.params.id, { login }, message);
    if (!sha) return res.json({ unchanged: true });
    res.status(201).json({ _id: sha, savedAt: new Date().toISOString(), manual: true });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// History = git log of the active branch. Shape preserved for the existing UI
// (_id is the commit sha; savedAt/author/name retained).
router.get('/:id/versions', async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const commits = await listCommits(req.params.id, activeRef(flow));
    res.json(commits.map((c) => ({
      _id: c.sha, flowId: req.params.id, savedAt: c.savedAt, author: c.author,
      name: flow.name, message: c.message,
    })));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.get('/:id/versions/:vid', async (req: Request, res: Response) => {
  try {
    const fields = await flowFieldsAtCommit(req.params.id, req.params.vid);
    res.json({ _id: req.params.vid, flowId: req.params.id, ...fields });
  } catch (err: any) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: err.message } });
  }
});

router.post('/:id/versions/:vid/restore', requireFlowEditAccess, async (req: Request, res: Response) => {
  const now = new Date().toISOString();
  try {
    const col = flowRepository;
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    let fields;
    try {
      fields = await flowFieldsAtCommit(req.params.id, req.params.vid);
    } catch (e: any) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } }) as any;
    }
    // Persist artifacts as content-addressed refs (git round-trips pointers now;
    // legacy commits round-trip inline bytes — ensureArtifactRefs handles both).
    const artifactRefs = await ensureArtifactRefs(fields.artifacts);
    await col.update({ _id: req.params.id }, { $set: {
      nodes: fields.nodes, edges: fields.edges, artifacts: artifactRefs, updatedAt: now,
    } });
    // Record the restore as a new commit so it's itself part of history.
    const login = (req as any).user?.login || 'unknown';
    await commitFlowState(req.params.id, { login }, `Restore commit ${req.params.vid.slice(0, 8)} by ${login}`);
    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// List git branches for this flow.
router.get('/:id/branches', async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const branches = await listBranches(req.params.id);
    res.json({ branches, active: flow.activeBranch || 'main' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Switch the active branch and materialize its HEAD into the flow doc — the
// executor runs whatever is currently in the doc.
router.post('/:id/branches/:name/checkout', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const updated = await checkoutBranchToDoc(req.params.id, req.params.name);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
  }
});

// Create a git branch from the current active HEAD (or an explicit commit/branch
// via `from`). Used by the editor's branch switcher "+" button.
router.post('/:id/branches', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const { name, from } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name is required' } }) as any;
    const branches = await createBranch(req.params.id, name, from);
    res.status(201).json({ branches, active: flow.activeBranch || 'main' });
  } catch (err: any) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
  }
});

// Delete a git branch. Refuses the default ("main") and the flow's active branch
// (deleteBranch enforces both). Unreachable objects + orphaned artifacts are GC'd.
router.delete('/:id/branches/:name', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const branches = await deleteBranch(req.params.id, req.params.name);
    res.json({ branches, active: flow.activeBranch || 'main' });
  } catch (err: any) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
  }
});

// Rework a branch around a commit. mode 'head' = reset --hard (drop descendants);
// mode 'root' = make the commit the new root (drop ancestors, replay descendants).
// Unreachable git objects + orphaned artifact blobs are GC'd immediately.
router.post('/:id/branches/:name/reset', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const { commit, mode } = req.body || {};
    if (!commit || typeof commit !== 'string') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'commit is required' } }) as any;
    if (mode !== 'head' && mode !== 'root') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: "mode must be 'head' or 'root'" } }) as any;
    const tip = await resetBranch(req.params.id, req.params.name, commit, mode as ResetMode);
    res.json({ tip, flow: await flowRepository.findOne({ _id: req.params.id }) });
  } catch (err: any) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
  }
});

// List the non-managed (user-pushed) files/folders of the active branch HEAD
// tree — anything not owned by the materializer (nodes/, sessions/, artifacts/,
// relations.json). Read-only; surfaced in the editor file tree.
router.get('/:id/tree/extra', async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const treeSha = await activeHeadTreeSha(req.params.id, flow);
    const entries = await listExtraEntries(req.params.id, treeSha);
    res.json({ entries, branch: activeBranchName(flow) });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Read one non-managed file's bytes for the read-only viewer. Returns text
// inline (utf8) when small and not binary, otherwise a download-only marker.
router.get('/:id/tree/file', async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const path = (req.query.path as string) || '';
    if (!path) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'path is required' } }) as any;
    const treeSha = await activeHeadTreeSha(req.params.id, flow);
    const blob = await resolveExtraPath(req.params.id, treeSha, path);
    if (!blob) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } }) as any;
    const size = blob.data.length;
    if (size > EXTRA_VIEW_MAX_BYTES || looksBinary(blob.data)) {
      return res.json({ name: blob.name, path, size, viewable: false }) as any;
    }
    res.json({ name: blob.name, path, size, viewable: true, content: blob.data.toString('utf8') });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Download one non-managed file as raw bytes. Auth via the standard
// Authorization header (apiClient.downloadBinary sets it on the XHR).
router.get('/:id/tree/raw', async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const path = (req.query.path as string) || '';
    if (!path) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'path is required' } }) as any;
    const treeSha = await activeHeadTreeSha(req.params.id, flow);
    const blob = await resolveExtraPath(req.params.id, treeSha, path);
    if (!blob) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } }) as any;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(blob.data.length));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(blob.name)}`);
    res.end(blob.data);
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    else res.destroy();
  }
});

// Upload one artifact as raw binary (filename in ?name= or X-Artifact-Name).
// Body is content-addressed into artifact_blobs; the flow doc keeps a {name,sha}
// ref. Committed to git so the artifact is versioned alongside the graph.
router.post('/:id/artifacts', requireFlowEditAccess, rawArtifact, async (req: Request, res: Response) => {
  try {
    const col = flowRepository;
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const name = (req.query.name as string) || req.header('x-artifact-name');
    if (!name) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'artifact name required (?name= or X-Artifact-Name)' } }) as any;
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'empty body' } }) as any;
    const [ref] = await putArtifacts([{ name, data: buf.toString('base64') }]);
    const artifacts = [...(flow.artifacts || []).filter((a: any) => a.name !== name), ref];
    await col.update({ _id: req.params.id }, { $set: { artifacts, updatedAt: new Date().toISOString() } });
    try {
      await commitFlowState(req.params.id, { login: (req as any).user?.login }, `Add artifact ${name}`);
    } catch (e: any) { console.warn('[flows] artifact commit failed:', e.message); }
    res.status(201).json({ artifact: ref, artifacts });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Streamed binary download by sha — chunk-by-chunk, never buffering the whole
// file. Auth via ?token= (a plain <a download> can't set an Authorization
// header). Only artifacts referenced by this flow are served.
router.get('/:id/artifacts/:sha/raw', async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const ref = (flow.artifacts || []).find((a: any) => a && a.sha === req.params.sha);
    if (!ref) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artifact not referenced by this flow' } }) as any;
    const size = await getArtifactSize(req.params.sha);
    if (size == null) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artifact blob not found' } }) as any;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(ref.name)}`);
    for await (const part of artifactChunks(req.params.sha)) {
      // Respect backpressure so a huge artifact can't balloon the send buffer.
      if (!res.write(part)) await new Promise<void>((r) => res.once('drain', () => r()));
    }
    res.end();
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    else res.destroy();
  }
});

// Download one artifact body (base64) by sha — only if referenced by this flow.
router.get('/:id/artifacts/:sha', async (req: Request, res: Response) => {
  try {
    const flow = await flowRepository.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const ref = (flow.artifacts || []).find((a: any) => a && a.sha === req.params.sha);
    if (!ref) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artifact not referenced by this flow' } }) as any;
    const data = await getArtifactBase64(req.params.sha);
    if (data == null) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artifact blob not found' } }) as any;
    res.json({ name: ref.name, sha: ref.sha, data });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Remove an artifact ref from the flow (blob is reclaimed later by the janitor).
router.delete('/:id/artifacts/:name', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const col = flowRepository;
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const name = decodeURIComponent(req.params.name);
    const artifacts = (flow.artifacts || []).filter((a: any) => a.name !== name);
    await col.update({ _id: req.params.id }, { $set: { artifacts, updatedAt: new Date().toISOString() } });
    try {
      await commitFlowState(req.params.id, { login: (req as any).user?.login }, `Remove artifact ${name}`);
    } catch (e: any) { console.warn('[flows] artifact commit failed:', e.message); }
    res.json({ artifacts });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/:id', requireFlowEditAccess, async (req: Request, res: Response) => {
  try {
    const col = flowRepository;
    const n = await col.remove({ _id: req.params.id });
    if (!n) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    // Cascade: drop the flow's git objects/refs and reclaim its now-orphaned
    // artifact blobs. Without this the git_objects linger and keep pinning blobs.
    try { await purgeFlowGit(req.params.id); }
    catch (e: any) { console.warn('[flows] purgeFlowGit failed:', e.message); }
    res.json({ message: 'Flow deleted' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    // Viewers are read-only — they must not be able to trigger executions.
    if (!user || (user.role !== 'admin' && user.role !== 'operator')) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only admins and operators can execute flows' } }) as any;
    }
    const col = flowRepository;
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    // Optional per-run overrides (subrow variants): a different worker and/or
    // branch than the flow defaults.
    const hasWorkerOverride = Object.prototype.hasOwnProperty.call(req.body || {}, 'workerId');
    let overrides: { workerId?: string; branch?: string } | undefined;
    if (hasWorkerOverride || req.body?.branch) {
      overrides = {};
      // Only set workerId when explicitly overridden — otherwise the executor
      // keeps the flow's own worker (an undefined-valued key would still count
      // as an override and wrongly force local execution).
      if (hasWorkerOverride) overrides.workerId = req.body.workerId || '';
      if (req.body?.branch) overrides.branch = req.body.branch;
    }
    // Accessibility gate: the worker this run will actually use (override or the
    // flow's own) must be permitted for the user.
    const effectiveWorkerId = hasWorkerOverride ? (req.body.workerId || '') : flow.workerId;
    if (effectiveWorkerId) {
      const worker = await workerRepository.findOne({ _id: effectiveWorkerId });
      if (worker && !canUserUseWorker(user, worker)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: `You are not allowed to run flows on worker "${worker.name}"` } }) as any;
      }
    }
    const triggeredUser: string | undefined = (req as any).user?.login;
    const executionId = await executeOrchestratorFlow(req.params.id, 'manual', triggeredUser, overrides);
    res.json({ executionId, message: 'Execution started' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.put('/:id/schedule', async (req: Request, res: Response) => {
  const { cron, enabled = true, timezone = 'UTC' } = req.body;
  if (!cron) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'cron is required' } }) as any;
  try {
    const col = flowRepository;
    const schedulesCol = scheduleRepository;
    const flow = await col.findOne({ _id: req.params.id });
    if (!flow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    const now = new Date().toISOString();
    await col.update({ _id: req.params.id }, { $set: { schedule: { cron, enabled, timezone }, updatedAt: now } });

    // Mirror into the schedules collection — that's what cronScheduler watches.
    // Without this the cron only fires after the next server restart (the
    // startup migration mirrors flow.schedule once). Upsert + (un)register now.
    // Only the flow-level cron (variant crons carry a variantId and are managed
    // separately per subrow) — never hijack a variant's schedule row.
    let sched = await schedulesCol.findOne({ flowId: req.params.id, type: 'cron', variantId: { $exists: false } });
    if (sched) {
      await schedulesCol.update({ _id: sched._id }, { $set: { cronExpr: cron, timezone, enabled, label: cron, updatedAt: now } });
      sched = { ...sched, cronExpr: cron, timezone, enabled };
    } else {
      sched = {
        _id: nowUid(), flowId: req.params.id, type: 'cron', cronExpr: cron, timezone,
        label: cron, enabled, createdBy: (req as any).user?._id || 'system', createdAt: now, updatedAt: now,
      };
      await schedulesCol.insert(sched);
    }
    unregisterCron(sched._id);
    if (enabled) registerCron(sched as any);

    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/:id/schedule', async (req: Request, res: Response) => {
  try {
    const col = flowRepository;
    const schedulesCol = scheduleRepository;
    await col.update({ _id: req.params.id }, { $set: { schedule: null, updatedAt: new Date().toISOString() } });
    // Tear down the mirrored cron row + its registered node-cron task.
    const sched = await schedulesCol.findOne({ flowId: req.params.id, type: 'cron' });
    if (sched) {
      unregisterCron(sched._id);
      await schedulesCol.remove({ _id: sched._id });
    }
    res.json(await col.findOne({ _id: req.params.id }));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
