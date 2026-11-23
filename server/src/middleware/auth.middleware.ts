import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

export function authenticateJWT(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // 1. Bearer token validation
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1] || parts[1].trim() === '') {
    res.status(401).json({ error: 'Invalid or malformed authorization header' });
    return;
  }

  const token = parts[1].trim();
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret || jwtSecret.trim() === '') {
    console.error('[Auth Middleware] JWT_SECRET is not configured');
    res.status(500).json({ error: 'Internal server configuration error' });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret, {
      algorithms: ['HS256'],
    });

    // 2. Runtime JWT payload validation
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as Record<string, unknown>).userId !== 'string' ||
      !(decoded as Record<string, string>).userId.trim() ||
      typeof (decoded as Record<string, unknown>).email !== 'string' ||
      !(decoded as Record<string, string>).email.trim()
    ) {
      res.status(401).json({ error: 'Invalid authentication token' });
      return;
    }

    const payload = decoded as { userId: string; email: string };
    req.user = {
      userId: payload.userId.trim(),
      email: payload.email.trim(),
    };
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token has expired' });
      return;
    }
    res.status(401).json({ error: 'Invalid authentication token' });
  }
}
