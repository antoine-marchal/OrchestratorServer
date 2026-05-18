import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../services/db/index';
import { hashApiKey, generateJWT, generateRefreshToken, verifyRefreshToken } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Auth endpoints (no auth required)
router.post('/auth/login', async (req: Request, res: Response) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'login and password required' } }) as any;

  try {
    const users = getCollection('users');
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

router.post('/auth/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'refreshToken required' } }) as any;

  try {
    const payload: any = verifyRefreshToken(refreshToken);
    const accessToken = generateJWT({ _id: payload._id, login: payload.login, role: payload.role });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired refresh token' } });
  }
});

// User CRUD — mounted at /api/v1 so paths include /users prefix
router.get('/users', authMiddleware, requireRole('admin', 'operator'), async (_req: Request, res: Response) => {
  try {
    const users = getCollection('users');
    const all = await users.find({});
    res.json(all.map((u: any) => ({ _id: u._id, login: u.login, role: u.role, createdAt: u.createdAt, apiKeys: (u.apiKeys || []).map((k: any) => ({ id: k.id, label: k.label, createdAt: k.createdAt, expiresAt: k.expiresAt, lastUsedAt: k.lastUsedAt })) })));
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.post('/users', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  const { login, password, role = 'operator' } = req.body;
  if (!login || !password) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'login and password required' } }) as any;

  try {
    const users = getCollection('users');
    const existing = await users.findOne({ login: login.toLowerCase() });
    if (existing) return res.status(409).json({ error: { code: 'CONFLICT', message: 'User already exists' } }) as any;

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const user = { _id: uuidv4(), login: login.toLowerCase(), passwordHash, role, apiKeys: [], createdAt: now, updatedAt: now };
    await users.insert(user);
    res.status(201).json({ _id: user._id, login: user.login, role: user.role, createdAt: user.createdAt });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

router.patch('/users/:id/password', authMiddleware, async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'password required' } }) as any;

  const caller = (req as any).user;
  // Admin can change any password; non-admin can only change their own
  if (caller.role !== 'admin' && caller._id !== req.params.id) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }) as any;
  }

  try {
    const users = getCollection('users');
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
    const users = getCollection('users');
    const removed = await users.remove({ _id: req.params.id });
    if (!removed) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }) as any;
    res.json({ message: 'User deleted' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// API Key management
router.post('/users/:id/apikeys', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  const { label, expiresAt } = req.body;
  if (!label) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'label required' } }) as any;

  try {
    const users = getCollection('users');
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
    const users = getCollection('users');
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
  res.json({ enabled, paramName });
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
    const validateUrl = `${proxyUrl}?${paramName}=${encodeURIComponent(ticket)}`;
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
    const users = getCollection('users');
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
