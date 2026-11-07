import express, { Router, Response } from 'express';
import type { Request } from '../request';
import crypto from 'crypto';
import { executionRepository, flowRepository, scheduleRepository, triggerTokenRepository } from '../../data/repositories';
import { executeOrchestratorFlow } from '../../domain/execution/flowExecutor';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { buildProxyAuthLoginRedirect, buildServiceUrl, proxyAuthConfig, validateProxyAuthTicket } from './users';

const router = Router();
const PROXY_AUTH_ATTEMPT_PARAM = '_triggerAttempt';
export const PROXY_AUTH_FALLBACK_MS = 5_000;
const pendingProxyAuthFallbacks = new Map<string, { timer: ReturnType<typeof setTimeout>; tokenHash: string }>();

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function requestIpAddress(req: Request): string {
  const address = req.ip || req.socket.remoteAddress || 'unknown';
  if (address === '::1') return '127.0.0.1';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export function triggerCallbackUrl(req: Request, ticketParam: string): string {
  const path = req.originalUrl.split('?')[0];
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === ticketParam) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') query.append(key, item);
    }
  }
  const suffix = query.size ? `${path}?${query.toString()}` : path;
  return `${buildServiceUrl().replace(/\/+$/, '')}${suffix}`;
}

export function withTriggerAttempt(serviceUrl: string, attemptId: string): string {
  const url = new URL(serviceUrl);
  url.searchParams.set(PROXY_AUTH_ATTEMPT_PARAM, attemptId);
  return url.toString();
}

export function scheduleProxyAuthFallback(attemptId: string, tokenHash: string, fallback: () => void, delayMs = PROXY_AUTH_FALLBACK_MS): void {
  const timer = setTimeout(() => {
    pendingProxyAuthFallbacks.delete(attemptId);
    fallback();
  }, delayMs);
  pendingProxyAuthFallbacks.set(attemptId, { timer, tokenHash });
}

export function consumeProxyAuthFallback(attemptId: string, tokenHash: string): boolean {
  const pending = pendingProxyAuthFallbacks.get(attemptId);
  if (!pending || pending.tokenHash !== tokenHash) return false;
  clearTimeout(pending.timer);
  pendingProxyAuthFallbacks.delete(attemptId);
  return true;
}

/* ── Synchronous ("wait") mode ──────────────────────────────────────────────
   `?wait=<seconds>` holds the HTTP request until the execution reaches a
   terminal state and returns its output, so a flow can serve as a REST
   endpoint. Capped by TRIGGER_MAX_WAIT_SECONDS (default 300). */

const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'KILLED']);
export const DEFAULT_MAX_WAIT_SECONDS = 300;

export function maxWaitSeconds(): number {
  const v = parseInt(process.env.TRIGGER_MAX_WAIT_SECONDS || '', 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_WAIT_SECONDS;
}

/** `?wait` → seconds to wait, or null for fire-and-forget. A bare `?wait`
 *  (or `wait=true`) waits for the maximum allowed time. */
export function parseWaitSeconds(raw: unknown, max = maxWaitSeconds()): number | null {
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'true') return max;
  if (v === 'false' || v === '0') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, max);
}

/** Flow input: a non-empty request body (POST) wins over the path segment. */
export function triggerInput(method: string, body: unknown, param: string | undefined): unknown {
  if (method === 'POST' && body !== undefined && body !== null) {
    if (typeof body === 'string' && body.trim() !== '') return body;
    if (typeof body === 'object' && Object.keys(body as object).length > 0) return body;
  }
  return param;
}

/** HTTP status for a finished (or still running) execution. */
export function httpStatusForExecution(status: string | undefined): number {
  if (status === 'SUCCESS') return 200;
  if (status === 'FAILED' || status === 'KILLED') return 500;
  return 202;
}

/** Poll an execution until it is terminal, the deadline passes, or `isAborted`
 *  reports the caller went away. Returns the last seen document. */
export async function waitForExecution(
  executionId: string,
  timeoutMs: number,
  opts: { pollMs?: number; load?: (id: string) => Promise<any>; isAborted?: () => boolean } = {},
): Promise<any> {
  const pollMs = opts.pollMs ?? 500;
  const load = opts.load ?? ((id: string) => executionRepository.findOne({ _id: id }));
  const deadline = Date.now() + timeoutMs;
  let exec: any = await load(executionId);
  while (!(exec && TERMINAL_STATUSES.has(exec.status)) && Date.now() < deadline && !opts.isAborted?.()) {
    await new Promise(r => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    exec = await load(executionId);
  }
  return exec;
}

/* ── Optional caller identification ─────────────────────────────────────────
   The trigger token is what authorizes the run. A programmatic caller MAY also
   identify itself so the execution is credited to a real user:
     - `Authorization: ApiKey <key>` or `Authorization: Bearer <jwt>`
     - `?<ticket param>=ST-…` — an SSO service ticket issued for this trigger URL
       (the URL without the ticket parameter), validated server-side with no
       redirect.
   Nothing supplied → the run is credited to the API trigger (caller IP), as
   before. Credentials supplied but invalid → 401, so a misconfigured client
   finds out instead of silently running anonymously. */

export type CallerIdentity =
  | { kind: 'anonymous' }
  | { kind: 'user'; login: string; via: 'apikey' | 'jwt' | 'ticket' }
  | { kind: 'invalid'; message: string };

/** Run the shared auth middleware against the request's Authorization header
 *  and report what it decided, without letting it write the response. */
export function authenticateHeader(
  req: Request,
  middleware: (req: Request, res: Response, next: () => void) => Promise<void> | void = authMiddleware,
): Promise<CallerIdentity> {
  return new Promise<CallerIdentity>((resolve) => {
    let status = 200;
    const capture: any = {
      status(code: number) { status = code; return capture; },
      json(body: any) {
        resolve({ kind: 'invalid', message: body?.error?.message || (status === 401 ? 'Invalid credentials' : 'Authentication error') });
        return capture;
      },
    };
    Promise.resolve(middleware(req, capture as Response, () => {
      const user = (req as any).user;
      if (user?.login) resolve({ kind: 'user', login: String(user.login), via: user.authType === 'apikey' ? 'apikey' : 'jwt' });
      else resolve({ kind: 'invalid', message: 'Invalid credentials' });
    })).catch(() => resolve({ kind: 'invalid', message: 'Authentication error' }));
  });
}

export async function identifyCaller(
  req: Request,
  deps: {
    authenticate?: (req: Request) => Promise<CallerIdentity>;
    validateTicket?: (ticket: string, serviceUrl: string) => Promise<string | null>;
    ssoConfig?: { paramName: string } | null;
  } = {},
): Promise<CallerIdentity> {
  if (req.headers['authorization']) {
    return (deps.authenticate ?? authenticateHeader)(req);
  }
  const sso = deps.ssoConfig !== undefined ? deps.ssoConfig : proxyAuthConfig();
  const ticketValue = sso ? req.query[sso.paramName] : undefined;
  if (sso && typeof ticketValue === 'string' && ticketValue) {
    try {
      const login = await (deps.validateTicket ?? validateProxyAuthTicket)(ticketValue, triggerCallbackUrl(req, sso.paramName));
      return login ? { kind: 'user', login, via: 'ticket' } : { kind: 'invalid', message: 'Invalid SSO ticket' };
    } catch (err: any) {
      return { kind: 'invalid', message: `SSO ticket validation failed: ${err?.message || err}` };
    }
  }
  return { kind: 'anonymous' };
}

async function executeResolvedTrigger(tokenDoc: any, schedule: any, param: unknown, actor: string, login: string | null): Promise<string | null> {
  if (tokenDoc.singleUse) {
    // The SSO callback and the timeout fallback share this atomic claim, so a
    // single-use URL still fires only once if they race each other.
    const claimed = await triggerTokenRepository.update({ _id: tokenDoc._id, used: false }, { $set: { used: true } });
    if (!claimed) throw new Error('Single-use token already used');
  }

  // Variant triggers carry a worker/branch override; verify the subrow still
  // exists so a deleted variant's token can't fire a ghost run.
  let overrides: { workerId?: string; branch?: string } | undefined;
  if (schedule.variantId) {
    const flow = await flowRepository.findOne({ _id: schedule.flowId });
    const exists = flow && Array.isArray(flow.variants) && flow.variants.some((variant: any) => variant.id === schedule.variantId);
    if (!exists) throw new Error('Subrow no longer exists');
    overrides = { workerId: schedule.workerId ?? '', branch: schedule.branch };
  }

  return executeOrchestratorFlow(
    schedule.flowId,
    'api',
    login || undefined,
    overrides,
    { input: param, actor },
  );
}

// Revoke a trigger token
router.post('/trigger-tokens/:id/revoke', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const col = triggerTokenRepository;
    const token = await col.findOne({ _id: req.params.id });
    if (!token) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } }) as any;
    await col.update({ _id: req.params.id }, { $set: { revokedAt: new Date().toISOString() } });
    res.json({ message: 'Token revoked' });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// Public trigger endpoint — token in URL.
//  - GET  /trigger/:token/:param?  the optional final path segment is the flow input.
//  - POST /trigger/:token/:param?  a non-empty request body (JSON or text) is the
//    flow input; otherwise the path segment is.
//  - ?wait=<seconds> (either method) holds the request until the execution ends
//    and responds with its status and output (200 success, 500 failed/killed,
//    202 when the wait runs out — poll /api/v1/executions/:id from there).
// When proxy auth is configured, a plain browser GET makes one SSO round-trip
// so the execution can be attributed to a user. POST and ?wait calls skip it:
// they come from programs that cannot follow an SSO login, and the token alone
// authorizes the run, exactly as the timeout fallback already does.
const handleTrigger = async (req: Request, res: Response) => {
  const { token } = req.params;
  const param = triggerInput(req.method, req.body, req.params.param);
  const waitSeconds = parseWaitSeconds(req.query.wait);
  const programmatic = req.method === 'POST' || waitSeconds !== null || !!req.headers['authorization'];
  const tokenHash = hashToken(token);

  try {
    const tokensCol = triggerTokenRepository;
    const schedulesCol = scheduleRepository;

    const tokenDoc = await tokensCol.findOne({ tokenHash });
    if (!tokenDoc) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }) as any;
    if (tokenDoc.revokedAt) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token has been revoked' } }) as any;
    if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) < new Date()) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token has expired' } }) as any;
    if (tokenDoc.singleUse && tokenDoc.used) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Single-use token already used' } }) as any;

    const schedule = await schedulesCol.findOne({ _id: tokenDoc.scheduleId });
    if (!schedule || !schedule.enabled) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Schedule not found or disabled' } }) as any;

    const proxyConfig = programmatic ? null : proxyAuthConfig();
    let serviceUrl = triggerCallbackUrl(req, proxyConfig?.paramName || 'ticket');
    let login: string | null = null;
    if (programmatic) {
      const caller = await identifyCaller(req);
      if (caller.kind === 'invalid') {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: caller.message } }) as any;
      }
      if (caller.kind === 'user') login = caller.login;
    }
    if (proxyConfig) {
      const ticketValue = req.query[proxyConfig.paramName];
      const ticket = typeof ticketValue === 'string' ? ticketValue : null;
      const attemptValue = req.query[PROXY_AUTH_ATTEMPT_PARAM];
      const attemptId = typeof attemptValue === 'string' ? attemptValue : null;

      // A callback claims its pending timeout before ticket validation. If the
      // timeout already claimed it, acknowledge the late callback without
      // running the flow a second time.
      if (ticket && attemptId && !consumeProxyAuthFallback(attemptId, tokenHash)) {
        return res.status(202).json({
          executionId: null,
          message: 'Flow trigger fallback already started',
          user: null,
          triggeredBy: `api - ${requestIpAddress(req)}`,
        });
      }

      // The SSO returned to the callback URL but did not include a ticket.
      // Keep the original fallback alive and avoid a redirect loop or a second
      // timeout for the same browser request.
      if (!ticket && attemptId) {
        return res.status(202).json({
          executionId: null,
          message: 'Waiting for IP-attributed trigger fallback',
          user: null,
          triggeredBy: `api - ${requestIpAddress(req)}`,
        });
      }

      if (!ticket) {
        try {
          const newAttemptId = crypto.randomBytes(16).toString('hex');
          serviceUrl = withTriggerAttempt(serviceUrl, newAttemptId);
          const redirectUrl = buildProxyAuthLoginRedirect(proxyConfig.loginUrl, serviceUrl);
          const fallbackActor = requestIpAddress(req);
          scheduleProxyAuthFallback(newAttemptId, tokenHash, () => {
            executeResolvedTrigger(tokenDoc, schedule, param, fallbackActor, null)
              .catch((error: any) => console.error(`[trigger] proxy-auth fallback failed: ${error.message}`));
          });
          return res.redirect(302, redirectUrl);
        } catch (error: any) {
          console.warn(`[trigger] proxy-auth redirect failed: ${error.message}`);
        }
      }
      if (ticket) {
        try {
          const extractedLogin = await validateProxyAuthTicket(ticket, serviceUrl);
          const user = extractedLogin ? extractedLogin : null;
          login = user || null;
        } catch (error: any) {
          // Authentication is used for attribution, not authorization. An SSO
          // outage must not turn a valid API token into a failed trigger.
          console.warn(`[trigger] proxy-auth attribution failed: ${error.message}`);
        }
      }
    }

    const actor = login || requestIpAddress(req);
    const executionId = await executeResolvedTrigger(tokenDoc, schedule, param, actor, login);
    const triggeredBy = `api - ${actor}`;
    if (!executionId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flow not found' } }) as any;
    }

    if (waitSeconds === null) {
      return res.json({ executionId, message: 'Flow triggered', user: login, triggeredBy }) as any;
    }

    let aborted = false;
    res.on('close', () => { if (!res.writableEnded) aborted = true; });
    const exec = await waitForExecution(executionId, waitSeconds * 1000, { isAborted: () => aborted });
    if (aborted) return;
    const status: string = exec?.status ?? 'RUNNING';
    const finished = TERMINAL_STATUSES.has(status);
    res.status(httpStatusForExecution(status)).json({
      executionId,
      status,
      output: finished ? (exec?.output ?? null) : null,
      error: finished ? (exec?.error ?? null) : null,
      duration: exec?.duration ?? null,
      triggeredBy,
      ...(finished ? {} : {
        message: `Still running after ${waitSeconds}s`,
        statusUrl: `/api/v1/executions/${executionId}`,
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
};

router.get('/trigger/:token{/:param}', handleTrigger);
router.post('/trigger/:token{/:param}', express.text({ type: ['text/*'], limit: process.env.JSON_BODY_LIMIT || '100mb' }), handleTrigger);

export default router;
