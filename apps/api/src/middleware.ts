import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from './auth.js';

export type AuthenticatedRequest = Request & {
  user?: { id: string; email: string; name: string };
};

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing or invalid authorization header.' });
    return;
  }

  try {
    const token = header.replace('Bearer ', '');
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
};
