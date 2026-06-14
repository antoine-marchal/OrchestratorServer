import { Request, Response, NextFunction } from 'express';

// Typed application error. Throw this from a route/middleware (synchronously, or
// inside an asyncHandler-wrapped handler) and the central errorHandler turns it
// into a consistent `{ error: { code, message } }` JSON response.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  static badRequest(message: string) { return new ApiError(400, 'BAD_REQUEST', message); }
  static unauthorized(message = 'Unauthorized') { return new ApiError(401, 'UNAUTHORIZED', message); }
  static forbidden(message = 'Forbidden') { return new ApiError(403, 'FORBIDDEN', message); }
  static notFound(message = 'Not found') { return new ApiError(404, 'NOT_FOUND', message); }
}

// Wrap an async route handler so a rejected promise is forwarded to the error
// handler. Express 4 does not catch async rejections on its own.
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Central Express error handler. Register LAST (after all routes). Maps ApiError
// to its status/code; anything else becomes a 500. Mirrors the existing
// `{ error: { code, message } }` envelope the routes already use.
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error('[errorHandler] Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err?.message || 'Internal server error' } });
}
