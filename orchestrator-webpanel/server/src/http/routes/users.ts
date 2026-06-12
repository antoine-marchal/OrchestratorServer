import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { userRepository } from '../../data/repositories';
import { hashApiKey, generateJWT, generateRefreshToken, verifyRefreshToken } from '../../infra/auth/tokens';
import { requireRole } from '../middleware/rbac';
import { authMiddleware } from '../middleware/auth';
import { validateBody } from '../validators/validate';
import { loginSchema, refreshSchema, createUserSchema, changePasswordSchema, createApiKeySchema } from '../validators/schemas';

const router = Router();

// Builds the CAS `service` URL from PROTOCOL + DOMAIN + PORT so it matches what
// the browser used. The same value must be sent at /login (ticket issuance) and
// /validate (ticket check), or a strict CAS server rejects the mismatch.
function buildServiceUrl(): string {
  const protocol = (process.env.HTTPS === 'true' || process.env.ORCHESTRATOR_HTTPS === 'true') ? 'https' : 'http';
  const domain = process.env.DOMAIN || process.env.ORCHESTRATOR_DOMAIN || 'http://localhost';
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3939;
  let serviceBase: string;
  if (/^https?:\/\//i.test(domain)) {
    serviceBase = domain.replace(/\/$/, '');
  } else {
    serviceBase = `${protocol}://${domain.replace(/\/$/, '')}`;
  }
  const hasPort = /:\d+$/.test(serviceBase.replace(/^https?:\/\//, ''));
  return hasPort ? serviceBase : `${serviceBase}:${port}`;
}

// Auth endpoints (no auth required)
router.post('/auth/login', validateBody(loginSchema), async (req: Request, res: Response) => {
  const { login, password } = req.body;
  try {
    const users = userRepository;
    const user = await users.findOne({ login: login.toLowerCase() });
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } }) as any;

    if (!user.passwordHash) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Password login disabled for this account' } }) as any;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } }) as any;

    const payload = { _id: user._id, login: user.login, role: user.role };
    const accessToken = generateJWT(payload);
    const refreshToken = generateRefreshToken(payload);

    res.json({ accessToken, refreshToken, user: { _id: user._id, login: user.login, role: user.role } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/auth/refresh', validateBody(refreshSchema), async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  try {
    const payload: any = verifyRefreshToken(refreshToken);
    // Re-load the user so a deleted account can't keep refreshing, and so the
    // new access token carries the CURRENT role (a demoted user shouldn't keep
    // elevated access for the remaining 7-day refresh window).
    const users = userRepository;
    const user = await users.findOne({ _id: payload._id });
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User no longer exists' } }) as any;
    const accessToken = generateJWT({ _id: user._id, login: user.login, role: user.role });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired refresh token' } });
  }
});

// User CRUD — mounted at /api/v1 so paths include /users prefix
router.get('/users', authMiddleware, requireRole('admin', 'operator'), async (_req: Request, res: Response) => {
  try {
    const users = userRepository;
    const all = await users.find({});
    res.json(all.map((u: any) => ({ _id: u._id, login: u.login, role: u.role, createdAt: u.createdAt, apiKeys: (u.apiKeys || []).map((k: any) => ({ id: k.id, label: k.label, createdAt: k.createdAt, expiresAt: k.expiresAt, lastUsedAt: k.lastUsedAt })) })));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/users', authMiddleware, requireRole('admin'), validateBody(createUserSchema), async (req: Request, res: Response) => {
  // Password is optional: a user without one is SSO-only (proxy-auth ticket
  // login). The /auth/login route already rejects them with "Password login
  // disabled for this account".
  const { login, password, role } = req.body;
  try {
    const users = userRepository;
    const existing = await users.findOne({ login: login.toLowerCase() });
    if (existing) return res.status(409).json({ error: { code: 'CONFLICT', message: 'User already exists' } }) as any;

    const passwordHash = password ? await bcrypt.hash(password, 12) : null;
    const now = new Date().toISOString();
    const user = { _id: uuidv4(), login: login.toLowerCase(), passwordHash, role, apiKeys: [], createdAt: now, updatedAt: now };
    await users.insert(user);
    res.status(201).json({ _id: user._id, login: user.login, role: user.role, createdAt: user.createdAt });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.patch('/users/:id/password', authMiddleware, validateBody(changePasswordSchema), async (req: Request, res: Response) => {
  const { password } = req.body;
  const caller = (req as any).user;
  // Admin can change any password; non-admin can only change their own
  if (caller.role !== 'admin' && caller._id !== req.params.id) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }) as any;
  }

  try {
    const users = userRepository;
    const user = await users.findOne({ _id: req.params.id });
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }) as any;
    const passwordHash = await bcrypt.hash(password, 12);
    await users.update({ _id: req.params.id }, { $set: { passwordHash, updatedAt: new Date().toISOString() } });
    res.json({ message: 'Password updated' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const users = userRepository;
    const target = await users.findOne({ _id: req.params.id });
    if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }) as any;
    // Never allow removing the last admin — that would permanently lock out
    // all admin access (covers an admin deleting themselves too).
    if (target.role === 'admin') {
      const adminCount = await users.count({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Cannot delete the last admin user' } }) as any;
      }
    }
    const removed = await users.remove({ _id: req.params.id });
    if (!removed) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }) as any;
    res.json({ message: 'User deleted' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// API Key management
router.post('/users/:id/apikeys', authMiddleware, requireRole('admin'), validateBody(createApiKeySchema), async (req: Request, res: Response) => {
  const { label, expiresAt } = req.body;
  try {
    const users = userRepository;
    const user = await users.findOne({ _id: req.params.id });
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }) as any;

    const rawKey = crypto.randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);
    const keyId = uuidv4();
    const newKey = { id: keyId, label, keyHash, createdAt: new Date().toISOString(), expiresAt: expiresAt || undefined, lastUsedAt: undefined };

    const updatedKeys = [...(user.apiKeys || []), newKey];
    await users.update({ _id: req.params.id }, { $set: { apiKeys: updatedKeys } });

    // Return raw key only once
    res.status(201).json({ id: keyId, label, rawKey, createdAt: newKey.createdAt, message: 'Save this key — it will not be shown again' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.delete('/users/:id/apikeys/:keyId', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const users = userRepository;
    const user = await users.findOne({ _id: req.params.id });
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }) as any;

    const updatedKeys = (user.apiKeys || []).filter((k: any) => k.id !== req.params.keyId);
    await users.update({ _id: req.params.id }, { $set: { apiKeys: updatedKeys } });
    res.json({ message: 'API key revoked' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Returns proxy auth config for the frontend (no auth required)
router.get('/authProxy/config', (_req: Request, res: Response) => {
  const paramName = process.env.ORCHESTRATOR_PROXYAUTH_NAME || 'ticket';
  const enabled = !!(process.env.ORCHESTRATOR_PROXYAUTH_URL && process.env.ORCHESTRATOR_PROXYAUTH_REGEX);
  // loginUrl: where the browser is bootstrapped to obtain a ticket. Explicit
  // env wins; otherwise derive it from the validate URL (CAS convention:
  // /validate and /login are siblings). service: the value the SSO must echo.
  let loginUrl: string | undefined;
  let service: string | undefined;
  if (enabled) {
    loginUrl = process.env.ORCHESTRATOR_PROXYAUTH_LOGIN_URL
      || process.env.ORCHESTRATOR_PROXYAUTH_URL!.replace(/\/validate\/?$/i, '/login');
    service = buildServiceUrl();
  }
  res.json({ enabled, paramName, loginUrl, service });
});

// Proxy authentication endpoint — bypasses password login via an external SSO ticket.
// Config env vars:
//   ORCHESTRATOR_PROXYAUTH_NAME  — query param name for the ticket (default: 'ticket')
//   ORCHESTRATOR_PROXYAUTH_URL   — base URL to validate ticket against
//   ORCHESTRATOR_PROXYAUTH_REGEX — regex to extract login from the validation response
router.get('/authProxy', async (req: Request, res: Response) => {
  const paramName = process.env.ORCHESTRATOR_PROXYAUTH_NAME || 'ticket';
  const proxyUrl = process.env.ORCHESTRATOR_PROXYAUTH_URL;
  const regexStr = process.env.ORCHESTRATOR_PROXYAUTH_REGEX;

  if (!proxyUrl || !regexStr) {
    return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'ProxyAuth not configured' } }) as any;
  }

  const ticket = req.query[paramName] as string;
  if (!ticket) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Missing query param: ${paramName}` } }) as any;
  }

  try {
    // Some SSO/CAS servers require the `service` parameter on the validation
    // call to match the URL the ticket was originally issued for.
    const serviceUrl = buildServiceUrl();
    const validateUrl = `${proxyUrl}?${paramName}=${encodeURIComponent(ticket)}&service=${encodeURIComponent(serviceUrl)}`;
    const body = await new Promise<string>((resolve, reject) => {
      const client = validateUrl.startsWith('https://') ? https : http;
      client.get(validateUrl, (response) => {
        let data = '';
        response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        response.on('end', () => resolve(data));
      }).on('error', reject);
    });

    const regex = new RegExp(regexStr);
    const match = body.match(regex);
    if (!match || !match[1]) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Could not extract login from validation response' } }) as any;
    }

    const login = match[1].trim().toLowerCase();
    const users = userRepository;
    const user = await users.findOne({ login });
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not found' } }) as any;
    }

    const payload = { _id: user._id, login: user.login, role: user.role };
    const accessToken = generateJWT(payload);
    const refreshToken = generateRefreshToken(payload);
    res.json({ accessToken, refreshToken, user: { _id: user._id, login: user.login, role: user.role } });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
