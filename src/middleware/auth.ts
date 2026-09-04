import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env';
import { AppError, ErrorCode } from '../lib/errors';
import logger from '../lib/logger';

interface JwtPayload {
  sub: string;
  role: 'admin';
  iat: number;
  exp: number;
}

/**
 * Create a signed JWT session token.
 */
export function createSession(username: string): string {
  const secret = env().JWT_SECRET;
  return jwt.sign(
    { sub: username, role: 'admin' },
    secret,
    { expiresIn: '24h' },
  );
}

/**
 * Middleware: requires a valid admin JWT in the Authorization header.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, ErrorCode.AUTHENTICATION_REQUIRED, 'Authentication required. Please login.');
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env().JWT_SECRET) as JwtPayload;

    if (payload.role !== 'admin') {
      throw new AppError(403, ErrorCode.AUTHENTICATION_REQUIRED, 'Insufficient permissions.');
    }

    // Attach user info to request for downstream use
    (req as any).user = { username: payload.sub, role: payload.role };
    next();
  } catch (err) {
    if (err instanceof AppError) throw err;

    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, ErrorCode.SESSION_EXPIRED, 'Session expired. Please login again.');
    }

    logger.warn({ err }, 'Invalid JWT token');
    throw new AppError(401, ErrorCode.AUTHENTICATION_REQUIRED, 'Invalid token. Please login again.');
  }
}
