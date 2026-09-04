import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Security headers via helmet.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: false, // Disabled because we serve static uploads
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/**
 * General API rate limiter: 100 requests per 15 minutes per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
});

/**
 * Strict rate limiter for auth endpoints: 10 attempts per 5 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false,
  message: { error: 'RATE_LIMITED', message: 'Too many login attempts. Please try again in 5 minutes.' },
});

/**
 * Payment rate limiter: 10 payment requests per 5 minutes per IP.
 */
export const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many payment attempts. Please wait before trying again.' },
});

/**
 * Request ID middleware — attaches a unique ID for tracing.
 */
let requestCounter = 0;
export function requestId(req: Request, _res: Response, next: () => void) {
  requestCounter++;
  (req as any).id = `${Date.now()}-${requestCounter}`;
  next();
}
