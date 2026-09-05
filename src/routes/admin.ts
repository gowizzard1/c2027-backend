import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin, createSession } from '../middleware/auth';
import { authLimiter } from '../middleware/security';
import {
  validate, loginSchema, newsSchema, productSchema,
  manifestoSchema, settingsSchema,
} from '../lib/validation';
import { AppError, ErrorCode } from '../lib/errors';
import logger from '../lib/logger';
import {
  validateAdmin, getDonations, getVolunteers, getOrders,
  updateVolunteerStatus, updateOrderStatus, regenerateVolunteerAccess, archiveVolunteer, restoreVolunteer,
  recordVolunteerInviteResult,
  getNews, addNewsItem, updateNewsItem, deleteNewsItem,
  getProducts, addProduct, updateProduct, deleteProduct,
  getSettings, updateSettings, getDonationProgress,
  getManifesto, addManifestoItem, updateManifestoItem, deleteManifestoItem,
  getBiography, upsertBioSection,
  getPaymentMode, setPaymentMode,
  getPledges, updatePledgeStatus, deletePledge,
  getAnalyticsSummary,
} from '../store';
import { isMpesaConfigured } from '../services/mpesa';
import { isCardConfigured } from '../services/card';
import { sendVolunteerInvite } from '../services/email';
import { getVolunteerById } from '../store';
import { env } from '../lib/env';

/** Build the activation + login links from the configured frontend URL. */
function volunteerLinks(accessToken: string) {
  const base = env().FRONTEND_URL.replace(/\/+$/, '');
  return {
    activationLink: `${base}/volunteer/toolkit?key=${accessToken}`,
    loginUrl: `${base}/volunteer/login`,
  };
}

const router = Router();

// --- Auth ---
router.post('/login', authLimiter, validate(loginSchema), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;

    if (!validateAdmin(username, password)) {
      logger.warn({ username }, 'Failed login attempt');
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Invalid username or password');
    }

    const token = createSession(username);
    logger.info({ username }, 'Admin login successful');
    return res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
});

// --- Stats ---
router.get('/stats', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [donations, volunteers, orders, progress] = await Promise.all([
      getDonations({ limit: 1000 }),
      getVolunteers({ limit: 1000 }),
      getOrders({ limit: 1000 }),
      getDonationProgress(),
    ]);
    return res.json({
      donations: {
        total: donations.length,
        completed: donations.filter((d: any) => d.status === 'completed').length,
        totalAmount: progress.raised,
      },
      volunteers: {
        total: volunteers.length,
        pollingAgents: volunteers.filter((v: any) => v.role === 'polling_agent').length,
        mobilizers: volunteers.filter((v: any) => v.role === 'mobilizer').length,
        socialMedia: volunteers.filter((v: any) => v.role === 'social_media').length,
      },
      orders: {
        total: orders.length,
        pending: orders.filter((o: any) => o.status === 'pending').length,
        totalRevenue: orders.reduce((sum: number, o: any) => sum + o.total, 0),
      },
      campaign: progress,
    });
  } catch (err) {
    next(err);
  }
});

// --- First-party site analytics ---
router.get('/analytics', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    return res.json(await getAnalyticsSummary(days));
  } catch (err) {
    next(err);
  }
});

// --- Donations (paginated) ---
router.get('/donations', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const donations = await getDonations({ page, limit });
    return res.json(donations);
  } catch (err) {
    next(err);
  }
});

// --- Volunteers (paginated) ---
router.get('/volunteers', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const archived = req.query.archived === 'true';
    const volunteers = await getVolunteers({ page, limit, archived });
    return res.json(volunteers);
  } catch (err) {
    next(err);
  }
});

router.patch('/volunteers/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['approved', 'rejected', 'suspended'];
    if (!allowedStatuses.includes(status)) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'status must be approved, rejected, or suspended');
    }

    const previous = await getVolunteerById(req.params.id);
    if (!previous || previous.status === 'archived') {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Volunteer not found');
    }
    const vol = await updateVolunteerStatus(req.params.id, status);
    if (!vol) throw new AppError(404, ErrorCode.NOT_FOUND, 'Volunteer not found');

    // Auto-email an invite for first-time approval or a reconsidered rejected application,
    // but do not re-send it merely because a suspended volunteer is unsuspended.
    if (status === 'approved' && previous && previous.status !== 'approved' && previous.status !== 'suspended' && vol.accessToken) {
      const { activationLink, loginUrl } = volunteerLinks(vol.accessToken);
      sendVolunteerInvite({ to: vol.email, name: vol.name, email: vol.email, activationLink, loginUrl })
        .then(async sent => {
          await recordVolunteerInviteResult(vol.id, sent);
          logger.info({ volunteerId: vol.id, sent }, 'Volunteer invite email dispatched');
        })
        .catch(async err => {
          await recordVolunteerInviteResult(vol.id, false);
          logger.warn({ err, volunteerId: vol.id }, 'Volunteer invite email failed');
        });
    }

    return res.json(vol);
  } catch (err) {
    next(err);
  }
});

// Reset a volunteer's access: new activation token + clear password (forgot-password flow).
router.post('/volunteers/:id/reset-access', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = require('crypto').randomBytes(24).toString('base64url');
    const vol = await regenerateVolunteerAccess(req.params.id, token);
    if (!vol) throw new AppError(404, ErrorCode.NOT_FOUND, 'Volunteer not found');

    // Email the fresh invite link automatically.
    const { activationLink, loginUrl } = volunteerLinks(token);
    sendVolunteerInvite({ to: vol.email, name: vol.name, email: vol.email, activationLink, loginUrl })
      .then(async sent => {
        await recordVolunteerInviteResult(vol.id, sent);
        logger.info({ volunteerId: vol.id, sent }, 'Volunteer reset invite dispatched');
      })
      .catch(async err => {
        await recordVolunteerInviteResult(vol.id, false);
        logger.warn({ err, volunteerId: vol.id }, 'Volunteer reset invite failed');
      });

    return res.json({ success: true, accessToken: token });
  } catch (err) {
    next(err);
  }
});

// Reversible archive — removes volunteer from the active list but preserves history.
router.post('/volunteers/:id/archive', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const volunteer = await archiveVolunteer(req.params.id);
    if (!volunteer) throw new AppError(404, ErrorCode.NOT_FOUND, 'Volunteer not found or already archived');
    logger.info({ volunteerId: volunteer.id, previousStatus: volunteer.statusBeforeArchive }, 'Volunteer archived by admin');
    return res.json(volunteer);
  } catch (err) {
    next(err);
  }
});

router.post('/volunteers/:id/restore', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const volunteer = await restoreVolunteer(req.params.id);
    if (!volunteer) throw new AppError(404, ErrorCode.NOT_FOUND, 'Archived volunteer not found');
    logger.info({ volunteerId: volunteer.id, restoredStatus: volunteer.status }, 'Volunteer restored by admin');
    return res.json(volunteer);
  } catch (err) {
    next(err);
  }
});

// --- Pledges (donation interest, paginated) ---
router.get('/pledges', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const pledges = await getPledges({ page, limit });
    return res.json(pledges);
  } catch (err) {
    next(err);
  }
});

router.patch('/pledges/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    if (!status) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Status is required');
    const pledge = await updatePledgeStatus(req.params.id, status);
    if (!pledge) throw new AppError(404, ErrorCode.NOT_FOUND, 'Pledge not found');
    return res.json(pledge);
  } catch (err) {
    next(err);
  }
});

router.delete('/pledges/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await deletePledge(req.params.id);
    if (!ok) throw new AppError(404, ErrorCode.NOT_FOUND, 'Pledge not found');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- Orders (paginated) ---
router.get('/orders', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const orders = await getOrders({ page, limit });
    return res.json(orders.map((o: any) => ({ ...o, items: JSON.parse(o.itemsJson || '[]') })));
  } catch (err) {
    next(err);
  }
});

router.patch('/orders/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    if (!status) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Status is required');
    const order = await updateOrderStatus(req.params.id, status);
    if (!order) throw new AppError(404, ErrorCode.NOT_FOUND, 'Order not found');
    return res.json(order);
  } catch (err) {
    next(err);
  }
});

// --- News ---
router.get('/news', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getNews(req.query.type as string));
  } catch (err) {
    next(err);
  }
});

router.post('/news', requireAdmin, validate(newsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, content, category, type, image, emoji, time, location } = req.body;
    const item = await addNewsItem({
      id: uuidv4(), title, content,
      date: new Date().toISOString().split('T')[0],
      category, type, image, emoji, time, location,
    });
    return res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.put('/news/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await updateNewsItem(req.params.id, req.body);
    if (!updated) throw new AppError(404, ErrorCode.NOT_FOUND, 'News item not found');
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/news/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await deleteNewsItem(req.params.id);
    if (!ok) throw new AppError(404, ErrorCode.NOT_FOUND, 'News item not found');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- Products ---
router.get('/products', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const products = await getProducts();
    return res.json(products.map((p: any) => ({ ...p, sizes: p.sizesJson ? JSON.parse(p.sizesJson) : [] })));
  } catch (err) {
    next(err);
  }
});

router.post('/products', requireAdmin, validate(productSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, price, image, category, sizes } = req.body;
    const product = await addProduct({
      id: uuidv4(), name, price: Number(price),
      image: image || '📦', category: category || 'General',
      sizesJson: sizes ? JSON.stringify(sizes) : undefined,
      inStock: true,
    });
    return res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

router.put('/products/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sizes, ...rest } = req.body;
    const data = { ...rest, ...(sizes ? { sizesJson: JSON.stringify(sizes) } : {}) };
    const updated = await updateProduct(req.params.id, data);
    if (!updated) throw new AppError(404, ErrorCode.NOT_FOUND, 'Product not found');
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/products/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await deleteProduct(req.params.id);
    if (!ok) throw new AppError(404, ErrorCode.NOT_FOUND, 'Product not found');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- Settings ---
router.get('/settings', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getSettings());
  } catch (err) {
    next(err);
  }
});

router.put('/settings', requireAdmin, validate(settingsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await updateSettings(req.body));
  } catch (err) {
    next(err);
  }
});

// --- Payment Mode ---
router.get('/payment-mode', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mode = await getPaymentMode();
    return res.json({
      mode,
      mpesaConfigured: isMpesaConfigured(),
      cardConfigured: isCardConfigured(),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/payment-mode', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mode } = req.body;
    if (mode !== 'live' && mode !== 'mock') {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'mode must be "live" or "mock"');
    }
    if (mode === 'live' && !isMpesaConfigured() && !isCardConfigured()) {
      throw new AppError(400, ErrorCode.PAYMENT_FAILED, 'Cannot switch to live mode — no payment credentials configured');
    }
    await setPaymentMode(mode);
    logger.info({ mode }, 'Payment mode updated');
    return res.json({ success: true, mode });
  } catch (err) {
    next(err);
  }
});

// --- Manifesto ---
router.get('/manifesto', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getManifesto());
  } catch (err) {
    next(err);
  }
});

router.post('/manifesto', requireAdmin, validate(manifestoSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pillar, title, description, details, icon, sortOrder } = req.body;
    const item = await addManifestoItem({
      id: uuidv4(), pillar, title, description, details, icon, sortOrder,
    });
    return res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.put('/manifesto/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await updateManifestoItem(req.params.id, req.body);
    if (!updated) throw new AppError(404, ErrorCode.NOT_FOUND, 'Manifesto item not found');
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/manifesto/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await deleteManifestoItem(req.params.id);
    if (!ok) throw new AppError(404, ErrorCode.NOT_FOUND, 'Manifesto item not found');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- Biography ---
router.get('/biography', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getBiography());
  } catch (err) {
    next(err);
  }
});

router.put('/biography/:section', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body;
    if (!content) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Content is required');
    return res.json(await upsertBioSection(req.params.section, content));
  } catch (err) {
    next(err);
  }
});

export default router;
