import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

/**
 * Simple in-memory idempotency store.
 * In production, replace with Redis or database-backed store.
 */
const idempotencyStore = new Map<string, { response: any; statusCode: number; timestamp: number }>();

// Clean up expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  const TTL = 30 * 60 * 1000; // 30 minutes
  for (const [key, entry] of idempotencyStore) {
    if (now - entry.timestamp > TTL) {
      idempotencyStore.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Idempotency middleware for payment endpoints.
 * Clients should send `Idempotency-Key` header to prevent duplicate processing.
 */
export function idempotencyCheck(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['idempotency-key'] as string;

  if (!key) {
    // No key provided — proceed normally (backward-compatible)
    return next();
  }

  const existing = idempotencyStore.get(key);
  if (existing) {
    logger.info({ idempotencyKey: key }, 'Duplicate request detected — returning cached response');
    return res.status(existing.statusCode).json(existing.response);
  }

  // Override res.json to capture the response
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    idempotencyStore.set(key, {
      response: body,
      statusCode: res.statusCode,
      timestamp: Date.now(),
    });
    return originalJson(body);
  };

  next();
}
