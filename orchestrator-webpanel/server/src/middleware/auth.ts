import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getCollection } from '../services/db/index';

export interface AuthUser {
  _id: string;
  login: string;
  role: string;
  authType: 'apikey' | 'jwt';
  apiKeyId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'orchestrator-jwt-secret-change-in-prod';

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function generateJWT(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function generateRefreshToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET + '-refresh', { expiresIn: '7d' });
}

export function verifyJWT(token: string): any {
  return jwt.verify(token, JWT_SECRET);
}

export function verifyRefreshToken(token: string): any {
  return jwt.verify(token, JWT_SECRET + '-refresh');
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  let authHeader = req.headers['authorization'] as string | undefined;

  // Fallback: accept JWT via ?token=... query param (for EventSource / file downloads
  // that can't set custom headers). Treated as a Bearer token.
  if (!authHeader && typeof req.query.token === 'string' && req.query.token) {
    authHeader = `Bearer ${req.query.token}`;
  }

  if (!authHeader) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header' } });
    return;
  }

  if (authHeader.startsWith('ApiKey ')) {
    const rawKey = authHeader.slice(7).trim();
    const keyHash = hashApiKey(rawKey);

    try {
      const users = getCollection('users');
      // Direct lookup via nested field — Mongo uses the apiKeys.keyHash index;
      // NeDB still scans but the query semantics are identical, so we avoid
      // dragging every user document into Node memory on every request.
      const matched: any[] = await users.find({ 'apiKeys.keyHash': keyHash });
      let matchedUser: any = null;
      let matchedKeyId: string | null = null;
      for (const user of matched) {
        const apiKey = (user.apiKeys || []).find((k: any) => k.keyHash === keyHash);
        if (!apiKey) continue;
        if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) continue;
        matchedUser = user;
        matchedKeyId = apiKey.id;
        const updatedKeys = user.apiKeys.map((k: any) =>
          k.id === apiKey.id ? { ...k, lastUsedAt: new Date().toISOString() } : k
        );
        await users.update({ _id: user._id }, { $set: { apiKeys: updatedKeys } });
        break;
      }

      if (!matchedUser) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
        return;
      }

      req.user = {
        _id: matchedUser._id,
        login: matchedUser.login,
        role: matchedUser.role,
        authType: 'apikey',
        apiKeyId: matchedKeyId || undefined,
      };
      next();
    } catch (err) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Auth error' } });
    }
    return;
  }

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      const payload: any = verifyJWT(token);
      req.user = {
        _id: payload._id,
        login: payload.login,
        role: payload.role,
        authType: 'jwt',
      };
      next();
    } catch {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    }
    return;
  }

  res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unsupported authorization scheme' } });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader) { next(); return; }
  // Try JWT only for optional
  if (authHeader.startsWith('Bearer ')) {
    try {
      const payload: any = verifyJWT(authHeader.slice(7).trim());
      req.user = { _id: payload._id, login: payload.login, role: payload.role, authType: 'jwt' };
    } catch { /* ignore */ }
  }
  next();
}
