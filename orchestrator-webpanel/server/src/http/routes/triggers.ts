import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { flowRepository, scheduleRepository, triggerTokenRepository } from '../../data/repositories';
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

async function executeResolvedTrigger(tokenDoc: any, schedule: any, param: string | undefined, actor: string, login: string | null): Promise<string | null> {
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

// Public trigger endpoint — token in URL. An optional final path segment is
// supplied as the flow input. When proxy auth is configured, browser callers
// make one SSO round-trip so the execution can be attributed to a user.
router.get('/trigger/:token/:param?', async (req: Request, res: Response) => {
  const { token, param } = req.params;
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

    const proxyConfig = proxyAuthConfig();
    let serviceUrl = triggerCallbackUrl(req, proxyConfig?.paramName || 'ticket');
    let login: string | null = null;
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
    res.json({ executionId, message: 'Flow triggered', user: login, triggeredBy: `api - ${actor}` });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
