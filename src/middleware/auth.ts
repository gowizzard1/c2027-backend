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

interface VolunteerJwtPayload {
  sub: string;           // VolunteerAccount ID
  role: 'volunteer';
  assignmentId: string;  // Selected VolunteerRoleAssignment ID
  vrole: string;
  sessionVersion: number;
  iat: number;
  exp: number;
}

/** Session token for an authenticated volunteer account and selected role assignment. */
export function createVolunteerSession(accountId: string, assignmentId: string, volunteerRole: string, sessionVersion: number): string {
  return jwt.sign(
    { sub: accountId, role: 'volunteer', assignmentId, vrole: volunteerRole, sessionVersion },
    env().JWT_SECRET,
    { expiresIn: '7d' },
  );
}

/** Middleware: requires a valid volunteer JWT. Attaches req.volunteer. */
export function requireVolunteer(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, ErrorCode.AUTHENTICATION_REQUIRED, 'Please log in to continue.');
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env().JWT_SECRET) as VolunteerJwtPayload;
    if (payload.role !== 'volunteer') {
      throw new AppError(403, ErrorCode.AUTHENTICATION_REQUIRED, 'Invalid session.');
    }
    (req as any).volunteer = {
      accountId: payload.sub,
      assignmentId: payload.assignmentId,
      role: payload.vrole,
      sessionVersion: payload.sessionVersion,
    };
    next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, ErrorCode.SESSION_EXPIRED, 'Session expired. Please log in again.');
    }
    throw new AppError(401, ErrorCode.AUTHENTICATION_REQUIRED, 'Invalid session. Please log in again.');
  }
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
