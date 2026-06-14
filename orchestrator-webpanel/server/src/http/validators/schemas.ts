import { z } from 'zod';

// Request-body schemas per endpoint. Wired into routes via validateBody().
// Parsed output replaces req.body, so handlers receive trimmed/defaulted data.

export const loginSchema = z.object({
  login: z.string().min(1, 'login required'),
  password: z.string().min(1, 'password required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken required'),
});

export const createUserSchema = z.object({
  login: z.string().min(1, 'login required'),
  password: z.string().optional(),
  role: z.string().default('operator'),
});

export const changePasswordSchema = z.object({
  password: z.string().min(1, 'password required'),
});

export const createApiKeySchema = z.object({
  label: z.string().min(1, 'label required'),
  expiresAt: z.string().optional(),
});

export const createSecretSchema = z.object({
  name: z.string().min(1, 'name required'),
  value: z.string().min(1, 'value required'),
  scope: z.enum(['global', 'flow', 'worker']).default('global'),
  flowId: z.string().optional(),
  workerId: z.string().optional(),
}).refine(d => d.scope !== 'worker' || !!d.workerId, {
  message: 'workerId required for worker-scoped secret',
  path: ['workerId'],
});
