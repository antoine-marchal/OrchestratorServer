// Pure token primitives: API-key hashing and JWT sign/verify. No Express, no
// DB. Adapter over `crypto` + `jsonwebtoken`. The HTTP auth middleware composes
// these with a user lookup; infra (e.g. the git repository auth gate) reuses the
// same hashing so credentials are compared consistently everywhere.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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
