import { Request, Response, NextFunction } from 'express';

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }
    if (req.user.role === 'admin') { next(); return; }
    if (roles.includes(req.user.role)) { next(); return; }
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }
    if (req.user.role === 'admin') { next(); return; }
    // Simplified: operators have most permissions
    if (req.user.role === 'operator' && !permission.includes('users') && !permission.includes('roles')) {
      next(); return;
    }
    if (req.user.role === 'viewer' && permission.endsWith(':read')) {
      next(); return;
    }
    res.status(403).json({ error: { code: 'FORBIDDEN', message: `Permission required: ${permission}` } });
  };
}
