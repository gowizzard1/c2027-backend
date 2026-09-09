import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { getOriginalClientIp } from '../lib/client-ip';

function clientIpKey(req: Request) {
  return `ip:${getOriginalClientIp(req)}`;
}

function isSafeReadRequest(req: Request) {
  return req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
}

/**
 * Security headers via helmet.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: false, // Disabled because we serve static uploads
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/**
 * General mutation limiter. Public reads are intentionally excluded: page data
 * must remain accessible, while edge/WAF controls handle read-volume abuse.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  skip: isSafeReadRequest,
  message: { error: 'RATE_LIMITED', message: 'Too many write requests. Please try again later.' },
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
  keyGenerator: clientIpKey,
  skip: isSafeReadRequest,
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
  keyGenerator: clientIpKey,
  message: { error: 'RATE_LIMITED', message: 'Too many payment attempts. Please wait before trying again.' },
});

/** Public signup creates database records and is intentionally more restrictive. */
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  message: { error: 'RATE_LIMITED', message: 'Too many volunteer registrations from this network. Please try again later.' },
});

/** Analytics writes are low-cost but must not become a database-write amplification vector. */
export const analyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  message: { error: 'RATE_LIMITED', message: 'Analytics request limit reached.' },
});

/** Public poll writes are expensive and browser tokens can be rotated, so throttle by network. */
export const pollVoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `poll-network:${getOriginalClientIp(req)}`,
  message: { error: 'RATE_LIMITED', message: 'Too many vote attempts from this network. Please wait before trying again.' },
});

function volunteerAccountKey(req: Request) {
  // This limiter is always placed after requireVolunteer; account ID is the stable
  // authenticated identity and avoids shared-IP bypasses or IPv6 parsing concerns.
  return `account:${(req as any).volunteer?.accountId || 'missing'}`;
}

/** Applies after requireVolunteer; bounds authenticated dashboard/report/stipend activity per account. */
export const volunteerActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: volunteerAccountKey,
  skip: isSafeReadRequest,
  message: { error: 'RATE_LIMITED', message: 'Too many account requests. Please wait before trying again.' },
});

/** File uploads are expensive and must be strictly bounded per authenticated account. */
export const resultUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: volunteerAccountKey,
  message: { error: 'RATE_LIMITED', message: 'Too many result upload attempts. Please wait before trying again.' },
});

function adminKey(req: Request) {
  return `admin:${(req as any).user?.username || clientIpKey(req)}`;
}

/** Email campaigns are intentionally bounded even for authenticated admins. */
export const pledgeEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminKey,
  message: { error: 'RATE_LIMITED', message: 'Too many pledge email campaigns. Please wait before sending another batch.' },
});

/** Administrative API is also rate-limited even after authentication. */
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  skip: isSafeReadRequest,
  message: { error: 'RATE_LIMITED', message: 'Too many administrative requests. Please wait before trying again.' },
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
