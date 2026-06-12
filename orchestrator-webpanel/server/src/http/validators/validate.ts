import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from '../middleware/errorHandler';

// Body-validation middleware. Parses req.body against a zod schema; on failure
// throws ApiError(400) (Express routes synchronous throws to the error handler).
// On success replaces req.body with the parsed/coerced value so handlers get
// typed, trimmed, defaulted data.
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      const path = first?.path?.join('.') ;
      const msg = first ? `${path ? path + ': ' : ''}${first.message}` : 'Invalid request body';
      throw ApiError.badRequest(msg);
    }
    req.body = result.data;
    next();
  };
}
