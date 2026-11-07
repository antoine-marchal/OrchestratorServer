import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { authenticateHeader, identifyCaller } from '../src/http/routes/triggers';

const req = (over: Partial<{ headers: any; query: any; originalUrl: string }> = {}) =>
  ({ headers: {}, query: {}, originalUrl: '/api/v1/trigger/tok?wait=30', ...over }) as unknown as Request;

describe('trigger caller identification', () => {
  it('is anonymous when nothing is supplied', async () => {
    expect(await identifyCaller(req(), { ssoConfig: { paramName: 'ticket' } })).toEqual({ kind: 'anonymous' });
  });

  it('credits the user behind a valid Authorization header', async () => {
    const authenticate = vi.fn(async () => ({ kind: 'user' as const, login: 'alice', via: 'apikey' as const }));
    const r = await identifyCaller(req({ headers: { authorization: 'ApiKey k' } }), { authenticate, ssoConfig: null });
    expect(r).toEqual({ kind: 'user', login: 'alice', via: 'apikey' });
  });

  it('prefers the Authorization header over a ticket', async () => {
    const validateTicket = vi.fn();
    await identifyCaller(
      req({ headers: { authorization: 'Bearer j' }, query: { ticket: 'ST-1' } }),
      { authenticate: async () => ({ kind: 'user', login: 'bob', via: 'jwt' }), validateTicket, ssoConfig: { paramName: 'ticket' } },
    );
    expect(validateTicket).not.toHaveBeenCalled();
  });

  it('validates a ticket against the trigger URL without the ticket param', async () => {
    const old = process.env.DOMAIN;
    process.env.DOMAIN = 'https://orch.example.test';
    try {
      const validateTicket = vi.fn(async () => 'carol');
      const r = await identifyCaller(
        req({ query: { ticket: 'ST-9', wait: '30' }, originalUrl: '/api/v1/trigger/tok?wait=30&ticket=ST-9' }),
        { validateTicket, ssoConfig: { paramName: 'ticket' } },
      );
      expect(r).toEqual({ kind: 'user', login: 'carol', via: 'ticket' });
      expect(validateTicket).toHaveBeenCalledWith('ST-9', 'https://orch.example.test/api/v1/trigger/tok?wait=30');
    } finally {
      if (old === undefined) delete process.env.DOMAIN; else process.env.DOMAIN = old;
    }
  });

  it('rejects a ticket the SSO does not accept', async () => {
    const r = await identifyCaller(req({ query: { ticket: 'ST-bad' } }), { validateTicket: async () => null, ssoConfig: { paramName: 'ticket' } });
    expect(r.kind).toBe('invalid');
  });

  it('ignores a ticket when SSO is not configured', async () => {
    const r = await identifyCaller(req({ query: { ticket: 'ST-1' } }), { ssoConfig: null });
    expect(r).toEqual({ kind: 'anonymous' });
  });

  it('reports the auth middleware verdict without writing the response', async () => {
    const ok = await authenticateHeader(req(), (r: Request, _res: Response, next: () => void) => {
      (r as any).user = { login: 'dave', authType: 'apikey' }; next();
    });
    expect(ok).toEqual({ kind: 'user', login: 'dave', via: 'apikey' });

    const bad = await authenticateHeader(req(), (_r: Request, res: Response) => {
      res.status(401).json({ error: { message: 'Invalid API key' } });
    });
    expect(bad).toEqual({ kind: 'invalid', message: 'Invalid API key' });
  });
});
