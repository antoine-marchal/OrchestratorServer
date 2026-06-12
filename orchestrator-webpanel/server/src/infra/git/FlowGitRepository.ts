import type { Request, Response, NextFunction } from 'express';
import { GitRepository, type GitRef, type GitObject, type ReceiveCommand, type ReceivedObject } from '@fusebit/cloud-git';
import { getCollection } from '../db/index';
import { hashApiKey } from '../../middleware/auth';
import {
  getObject as storeGetObject,
  putObject,
  setRef,
  deleteRef,
  listRefs,
} from './gitStore';
import {
  ensureInitialized,
  activeRef,
  syncDocFromRefIfActive,
} from './flowCommit';

const ZERO_ID = '0'.repeat(40);

// flowId is captured by a wrapper middleware in server.ts. The library mounts its
// routes on a plain express.Router() (no mergeParams), so req.params.flowId is not
// visible inside these handlers — we read the stashed copy instead.
function flowIdOf(req: Request): string {
  return (req as any).gitFlowId || (req.params && (req.params as any).flowId) || '';
}

interface GitUser {
  _id: string;
  login: string;
  role: string;
}

async function authenticateApiKey(login: string, rawKey: string): Promise<GitUser | null> {
  if (!login || !rawKey) return null;
  const users = getCollection('users');
  const keyHash = hashApiKey(rawKey);
  const matched: any[] = await users.find({ 'apiKeys.keyHash': keyHash });
  for (const user of matched) {
    if (String(user.login).toLowerCase() !== login.toLowerCase()) continue;
    const apiKey = (user.apiKeys || []).find((k: any) => k.keyHash === keyHash);
    if (!apiKey) continue;
    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) continue;
    // Record usage so the admin "last used" metric reflects git operations.
    // The JWT path does this in middleware/auth.ts; git auth runs here instead,
    // so without this an API key used only for `git push/clone` shows "never used".
    try {
      const updatedKeys = (user.apiKeys || []).map((k: any) =>
        k.id === apiKey.id ? { ...k, lastUsedAt: new Date().toISOString() } : k,
      );
      await users.update({ _id: user._id }, { $set: { apiKeys: updatedKeys } });
    } catch { /* usage stamp is best-effort — never block auth on it */ }
    return { _id: user._id, login: user.login, role: user.role };
  }
  return null;
}

// Mirror of canUserEditFlow in routes/flows.ts: admins edit anything; operators
// edit unowned/own/operator-owned flows but not admin-owned ones; viewers never.
async function canEdit(user: GitUser, flow: any): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role !== 'operator') return false;
  const ownerLogin = flow?.owner;
  if (!ownerLogin || ownerLogin === user.login) return true;
  const owner = await getCollection('users').findOne({ login: ownerLogin });
  if (!owner) return true;
  return owner.role !== 'admin';
}

function isWriteRequest(req: Request): boolean {
  const svc = (req.query && (req.query as any).service) || '';
  return svc === 'git-receive-pack' || req.path.includes('git-receive-pack');
}

function requireAuth(res: Response): void {
  res.status(401).set('www-authenticate', 'Basic realm="orchestrator-git"').end();
}

export class FlowGitRepository extends GitRepository {
  // NOTE: invoked unbound as express middleware — must not use `this`.
  async authorize(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const flowId = flowIdOf(req);
      const flow = await getCollection('flows').findOne({ _id: flowId });
      if (!flow) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } });
        return;
      }
      const header = req.headers['authorization'];
      if (!header || !header.startsWith('Basic ')) {
        requireAuth(res);
        return;
      }
      const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const login = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      const user = await authenticateApiKey(login, pass);
      if (!user) {
        requireAuth(res);
        return;
      }
      if (isWriteRequest(req) && !(await canEdit(user, flow))) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No push access to this flow' } });
        return;
      }
      (req as any).gitUser = user;
      next();
    } catch {
      res.status(500).end();
    }
  }

  private async computeHead(flowId: string): Promise<GitRef | null> {
    const flow = await getCollection('flows').findOne({ _id: flowId });
    const refs = await listRefs(flowId);
    if (refs.length === 0) return null;
    const preferred = flow ? activeRef(flow) : 'refs/heads/main';
    const match = refs.find((r) => r.ref === preferred) || refs.find((r) => r.ref.startsWith('refs/heads/'));
    return match ? { ref: match.ref, sha: match.sha } : null;
  }

  async getRefs(req: Request): Promise<GitRef[]> {
    const flowId = flowIdOf(req);
    await ensureInitialized(flowId);
    const refs = await listRefs(flowId);
    const head = await this.computeHead(flowId);
    // Advertise HEAD first so clients pick a default branch on clone.
    const out: GitRef[] = [];
    if (head) out.push({ ref: 'HEAD', sha: head.sha });
    for (const r of refs.sort((a, b) => a.ref.localeCompare(b.ref))) out.push(r);
    return out;
  }

  async getHeadRef(req: Request): Promise<string | undefined> {
    const head = await this.computeHead(flowIdOf(req));
    return head ? head.ref : undefined;
  }

  async getObject(req: Request, sha: string): Promise<GitObject> {
    const flowId = flowIdOf(req);
    const obj = await storeGetObject(flowId, sha);
    if (!obj) throw new Error(`Object ${sha} not found.`);
    return { objectType: obj.objectType, data: obj.data };
  }

  async receivePack(req: Request, commands: ReceiveCommand[], objects: ReceivedObject[]): Promise<void> {
    const flowId = flowIdOf(req);
    // Persist every pushed object first so refs always resolve.
    for (const o of objects) {
      const sha = o.sha.toString('hex');
      await putObject(flowId, sha, o.objectType, o.data);
    }
    const touched: string[] = [];
    for (const cmd of commands) {
      if (cmd.destId === ZERO_ID) {
        await deleteRef(flowId, cmd.ref);
      } else {
        await setRef(flowId, cmd.ref, cmd.destId);
        touched.push(cmd.ref);
      }
    }
    // If the active branch advanced, materialize it into the flow doc.
    for (const ref of touched) {
      try {
        await syncDocFromRefIfActive(flowId, ref);
      } catch (e: any) {
        console.warn(`[git] sync doc from ${ref} failed:`, e.message);
      }
    }
  }
}

export const flowGitRepository = new FlowGitRepository();
