import type { Request as ExpressRequest } from 'express';

/**
 * Express 5 types every route param as `string | string[]` (wildcard
 * `*splat` params are arrays). Our routes only declare named `:param`
 * segments, which are always strings at runtime — this alias keeps
 * handlers typed accordingly.
 */
export type Request = ExpressRequest<Record<string, string>>;
