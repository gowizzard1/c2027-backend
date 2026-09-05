import { Router, Request, Response, NextFunction } from 'express';
import { recordAnalyticsEvent } from '../store';
import logger from '../lib/logger';

const router = Router();

const DEVICE_TYPES = new Set(['mobile', 'tablet', 'desktop', 'unknown']);

/**
 * Anonymous first-party pageview endpoint.
 * Intentionally stores no IP address, raw user agent, query parameters, or full referrer URL.
 */
router.post('/pageview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const visitorId = typeof req.body?.visitorId === 'string' ? req.body.visitorId.trim() : '';
    const path = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const referrerDomain = typeof req.body?.referrerDomain === 'string' ? req.body.referrerDomain.trim() : '';
    const deviceType = typeof req.body?.deviceType === 'string' ? req.body.deviceType : 'unknown';

    // Silently accept invalid events so tracking never affects the visitor experience.
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(visitorId) || !path.startsWith('/') || path.length > 300) {
      return res.status(204).end();
    }

    await recordAnalyticsEvent({
      visitorId,
      path,
      referrerDomain: referrerDomain.slice(0, 255) || undefined,
      deviceType: DEVICE_TYPES.has(deviceType) ? deviceType : 'unknown',
    });

    return res.status(204).end();
  } catch (err) {
    // Analytics must never cause a visible client failure. Log for diagnostics only.
    logger.warn({ err }, 'Analytics pageview could not be recorded');
    return res.status(204).end();
  }
});

export default router;
