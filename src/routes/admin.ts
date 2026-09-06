import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin, createSession } from '../middleware/auth';
import { authLimiter, adminLimiter } from '../middleware/security';
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
  getStipendRequests, approveStipendRequest, rejectStipendRequest, markStipendRequestPaid,
  getMobilizerReports, updateMobilizerReportStatus,
  getVolunteerAccounts, getVolunteerAccountById, getVolunteerAccountStats, getRoleAssignmentById,
  updateRoleAssignmentStatus, archiveRoleAssignment, restoreRoleAssignment,
  resetAccountAccess, recordAccountInviteResult,
  getAccountStipendRequests, getAssignmentMobilizerReports,
  getPollingStations, addPollingStation, setPollingStationActive, updatePollingStationApproval,
  getElectionCandidates, addElectionCandidate, setElectionCandidateActive,
  archiveElectionCandidate, restoreElectionCandidate,
  deleteElectionCandidate,
  updateElectionCandidate,
  getMobileAppReleases, createMobileAppRelease, activateMobileAppRelease, archiveMobileAppRelease, deleteMobileAppRelease,
  getPollingResultReports, getPollingResultAttachment, updatePollingResultStatus, archivePollingResultReport,
} from '../store';
import { isMpesaConfigured } from '../services/mpesa';
import { isCardConfigured } from '../services/card';
import { sendVolunteerInvite } from '../services/email';
import { getPrivateObject } from '../services/storage';
import { getVolunteerById } from '../store';
import { env } from '../lib/env';
import { isTurboWard, TURBO_COUNTY, TURBO_CONSTITUENCY, TURBO_WARDS } from '../lib/polling';

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

// Applies to every protected admin route below, in addition to the global API limit.
router.use(adminLimiter);

// --- Stats ---
router.get('/stats', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [donations, volunteerStats, orders, progress] = await Promise.all([
      getDonations({ limit: 1000 }),
      getVolunteerAccountStats(),
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
        total: volunteerStats.totalAccounts,
        roleAssignments: volunteerStats.roleAssignments,
        pollingAgents: volunteerStats.pollingAgents,
        mobilizers: volunteerStats.mobilizers,
        socialMedia: volunteerStats.socialMedia,
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

// --- Multi-role volunteer accounts (new account/assignment model) ---
router.get('/volunteer-accounts', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const archived = req.query.archived === 'true';
    return res.json(await getVolunteerAccounts({ page, limit, archived }));
  } catch (err) {
    next(err);
  }
});

router.patch('/volunteer-assignments/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'suspended'].includes(status)) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'status must be approved, rejected, or suspended');
    }
    const previous = await getRoleAssignmentById(req.params.id);
    if (!previous || previous.status === 'archived') throw new AppError(404, ErrorCode.NOT_FOUND, 'Role assignment not found');
    const assignment = await updateRoleAssignmentStatus(previous.id, status);
    if (!assignment) throw new AppError(404, ErrorCode.NOT_FOUND, 'Role assignment not found');

    // First account activation invite, not one invite per role. Additional approved roles
    // appear on the existing account automatically after login.
    const account = await getVolunteerAccountById(assignment.accountId);
    if (status === 'approved' && previous.status !== 'approved' && previous.status !== 'suspended' && account && !account.passwordHash && account.accessToken) {
      const { activationLink, loginUrl } = volunteerLinks(account.accessToken);
      sendVolunteerInvite({ to: account.email, name: account.name, email: account.email, activationLink, loginUrl })
        .then(async sent => { await recordAccountInviteResult(account.id, sent); logger.info({ accountId: account.id, assignmentId: assignment.id, sent }, 'Volunteer account invite dispatched'); })
        .catch(async err => { await recordAccountInviteResult(account.id, false); logger.warn({ err, accountId: account.id, assignmentId: assignment.id }, 'Volunteer account invite failed'); });
    }
    return res.json(assignment);
  } catch (err) {
    next(err);
  }
});

router.post('/volunteer-accounts/:id/reset-access', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { account, accessToken } = await resetAccountAccess(req.params.id);
    const { activationLink, loginUrl } = volunteerLinks(accessToken);
    sendVolunteerInvite({ to: account.email, name: account.name, email: account.email, activationLink, loginUrl })
      .then(async sent => { await recordAccountInviteResult(account.id, sent); logger.info({ accountId: account.id, sent }, 'Account reset invite dispatched'); })
      .catch(async err => { await recordAccountInviteResult(account.id, false); logger.warn({ err, accountId: account.id }, 'Account reset invite failed'); });
    return res.json({ success: true, accessToken });
  } catch (err) {
    next(err);
  }
});

router.post('/volunteer-assignments/:id/archive', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignment = await archiveRoleAssignment(req.params.id);
    if (!assignment) throw new AppError(404, ErrorCode.NOT_FOUND, 'Role assignment not found or already archived');
    return res.json(assignment);
  } catch (err) {
    next(err);
  }
});

router.post('/volunteer-assignments/:id/restore', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignment = await restoreRoleAssignment(req.params.id);
    if (!assignment) throw new AppError(404, ErrorCode.NOT_FOUND, 'Archived role assignment not found');
    return res.json(assignment);
  } catch (err) {
    next(err);
  }
});

// --- Turbo Constituency polling station registry ---
router.get('/polling-stations', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const stations = await getPollingStations(includeInactive);
    return res.json(stations.map(station => ({ ...station, validWard: isTurboWard(station.ward) })));
  } catch (err) {
    next(err);
  }
});

router.get('/polling-station-config', requireAdmin, async (_req: Request, res: Response) => {
  return res.json({ county: TURBO_COUNTY, constituency: TURBO_CONSTITUENCY, wards: TURBO_WARDS });
});

router.post('/polling-stations', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const ward = typeof req.body?.ward === 'string' ? req.body.ward.trim() : '';
    if (!name || !ward || name.length > 150 || ward.length > 100 || !isTurboWard(ward)) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, `Station name and an official Turbo ward are required: ${TURBO_WARDS.join(', ')}.`);
    }
    return res.status(201).json(await addPollingStation({ name, ward }));
  } catch (err) {
    next(err);
  }
});

router.patch('/polling-stations/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.active !== 'boolean') {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'active must be true or false.');
    }
    const station = await setPollingStationActive(req.params.id, req.body.active);
    if (!station) throw new AppError(404, ErrorCode.NOT_FOUND, 'Polling station not found.');
    return res.json(station);
  } catch (err) {
    next(err);
  }
});

router.post('/polling-stations/:id/review', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action } = req.body;
    if (action !== 'approve' && action !== 'reject') {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'action must be approve or reject.');
    }
    const station = await updatePollingStationApproval(req.params.id, action === 'approve' ? 'approved' : 'rejected');
    if (!station) throw new AppError(404, ErrorCode.NOT_FOUND, 'Polling station not found.');
    return res.json(station);
  } catch (err) {
    next(err);
  }
});

// --- Election candidate registry and private polling result review ---
router.get('/election-candidates', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getElectionCandidates(req.query.includeInactive === 'true'));
  } catch (err) {
    next(err);
  }
});

router.post('/election-candidates', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const party = typeof req.body?.party === 'string' ? req.body.party.trim() : '';
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    if (!name || name.length > 150 || party.length > 150 || imageUrl.length > 500) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Candidate name is required and values must be concise.');
    if (imageUrl) {
      const isLocalCandidateUpload = /^\/uploads\/candidate-images\/[A-Za-z0-9._/-]+$/.test(imageUrl);
      const isAbsoluteUrl = (() => {
        try {
          const url = new URL(imageUrl);
          return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
          return false;
        }
      })();
      if (!isLocalCandidateUpload && !isAbsoluteUrl) {
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Candidate image must be a valid URL or uploaded candidate image path.');
      }
    }
    return res.status(201).json(await addElectionCandidate({ name, party: party || undefined, imageUrl: imageUrl || undefined }));
  } catch (err) {
    next(err);
  }
});

router.put('/election-candidates/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const party = typeof req.body?.party === 'string' ? req.body.party.trim() : '';
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    if (!name || name.length > 150 || party.length > 150 || imageUrl.length > 500) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Candidate name is required and values must be concise.');
    if (imageUrl) {
      const isLocalCandidateUpload = /^\/uploads\/candidate-images\/[A-Za-z0-9._/-]+$/.test(imageUrl);
      const isAbsoluteUrl = (() => { try { const url = new URL(imageUrl); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; } })();
      if (!isLocalCandidateUpload && !isAbsoluteUrl) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Candidate image must be a valid URL or uploaded candidate image path.');
    }
    const candidate = await updateElectionCandidate(req.params.id, { name, party: party || undefined, imageUrl: imageUrl || undefined });
    if (!candidate) throw new AppError(404, ErrorCode.NOT_FOUND, 'Candidate not found or update conflicts with an existing candidate.');
    return res.json(candidate);
  } catch (err) {
    next(err);
  }
});

router.patch('/election-candidates/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.active !== 'boolean') throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'active must be true or false.');
    const candidate = await setElectionCandidateActive(req.params.id, req.body.active);
    if (!candidate) throw new AppError(404, ErrorCode.NOT_FOUND, 'Candidate not found.');
    return res.json(candidate);
  } catch (err) {
    next(err);
  }
});

router.post('/election-candidates/:id/archive', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const candidate = await archiveElectionCandidate(req.params.id);
    if (!candidate) throw new AppError(404, ErrorCode.NOT_FOUND, 'Candidate not found or already archived.');
    return res.json(candidate);
  } catch (err) {
    next(err);
  }
});

router.post('/election-candidates/:id/restore', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const candidate = await restoreElectionCandidate(req.params.id);
    if (!candidate) throw new AppError(404, ErrorCode.NOT_FOUND, 'Archived candidate not found.');
    return res.json(candidate);
  } catch (err) {
    next(err);
  }
});

router.delete('/election-candidates/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await deleteElectionCandidate(req.params.id);
    if (!deleted) throw new AppError(409, ErrorCode.VALIDATION_ERROR, 'Could not delete this candidate. Archive it instead if you need to preserve it.');
    logger.info({ candidateId: req.params.id }, 'Election candidate deleted by admin');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/polling-results', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    return res.json(await getPollingResultReports({ page, limit }));
  } catch (err) {
    next(err);
  }
});

router.patch('/polling-results/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, reviewNote } = req.body;
    const note = typeof reviewNote === 'string' ? reviewNote.trim().slice(0, 2000) : undefined;
    if (action === 'archive') {
      const archivedBy = (req as any).user?.username || 'admin';
      const report = await archivePollingResultReport(req.params.id, archivedBy, note);
      if (!report) throw new AppError(404, ErrorCode.NOT_FOUND, 'Polling result report not found or already archived.');
      logger.info({ pollingResultId: report.id, archivedBy }, 'Polling result archived by admin');
      return res.json(report);
    }
    const mapping: Record<string, 'under_review' | 'verified' | 'disputed'> = { review: 'under_review', verify: 'verified', dispute: 'disputed' };
    if (!mapping[action]) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'action must be review, verify, dispute, or archive.');
    const report = await updatePollingResultStatus(req.params.id, mapping[action], note);
    if (!report) throw new AppError(404, ErrorCode.NOT_FOUND, 'Polling result report not found.');
    logger.info({ pollingResultId: report.id, action }, 'Polling result reviewed by admin');
    return res.json(report);
  } catch (err) {
    next(err);
  }
});

router.get('/polling-results/:reportId/attachments/:attachmentId', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attachment = await getPollingResultAttachment(req.params.reportId, req.params.attachmentId);
    if (!attachment) throw new AppError(404, ErrorCode.NOT_FOUND, 'Result form attachment not found.');
    const object = await getPrivateObject(attachment.objectKey);
    const body: any = object.body;
    const bytes = await body.transformToByteArray();
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(Buffer.from(bytes));
  } catch (err) {
    next(err);
  }
});

// --- Mobile app release distribution ---
router.get('/mobile-app-releases', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getMobileAppReleases());
  } catch (err) {
    next(err);
  }
});

router.post('/mobile-app-releases', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
    const version = typeof req.body?.version === 'string' ? req.body.version.trim() : '';
    const buildNumber = typeof req.body?.buildNumber === 'string' ? req.body.buildNumber.trim() : '';
    const fileUrl = typeof req.body?.fileUrl === 'string' ? req.body.fileUrl.trim() : '';
    const externalUrl = typeof req.body?.externalUrl === 'string' ? req.body.externalUrl.trim() : '';
    const releaseNotes = typeof req.body?.releaseNotes === 'string' ? req.body.releaseNotes.trim() : '';
    if (!version || version.length > 50 || releaseNotes.length > 2000) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Version is required and release notes must be concise.');
    if (platform === 'android' && !fileUrl) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Upload an Android APK before publishing this release.');
    if (platform === 'ios' && !externalUrl) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Provide a TestFlight or App Store link for iOS.');
    return res.status(201).json(await createMobileAppRelease({ platform, version, buildNumber: buildNumber || undefined, fileUrl: fileUrl || undefined, externalUrl: externalUrl || undefined, releaseNotes: releaseNotes || undefined }));
  } catch (err) {
    next(err);
  }
});

router.patch('/mobile-app-releases/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action } = req.body;
    if (action === 'activate') {
      const release = await activateMobileAppRelease(req.params.id);
      if (!release) throw new AppError(404, ErrorCode.NOT_FOUND, 'Release not found or archived.');
      return res.json(release);
    }
    if (action === 'archive') {
      const release = await archiveMobileAppRelease(req.params.id);
      if (!release) throw new AppError(404, ErrorCode.NOT_FOUND, 'Release not found.');
      return res.json(release);
    }
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'action must be activate or archive.');
  } catch (err) {
    next(err);
  }
});

router.delete('/mobile-app-releases/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await deleteMobileAppRelease(req.params.id);
    if (!deleted) throw new AppError(404, ErrorCode.NOT_FOUND, 'Release not found.');
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- Volunteers (legacy role rows; retained during migration window) ---
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

// --- Mobile-data stipend requests (manual payment until M-Pesa automation is enabled) ---
router.get('/stipend-requests', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    return res.json(await getAccountStipendRequests({ page, limit }));
  } catch (err) {
    next(err);
  }
});

router.patch('/stipend-requests/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, adminNote, paymentRef } = req.body;
    let request = null;
    if (action === 'approve') request = await approveStipendRequest(req.params.id, adminNote);
    if (action === 'reject') request = await rejectStipendRequest(req.params.id, adminNote);
    if (action === 'mark_paid') request = await markStipendRequestPaid(req.params.id, paymentRef);
    if (!['approve', 'reject', 'mark_paid'].includes(action)) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'action must be approve, reject, or mark_paid');
    }
    if (!request) {
      throw new AppError(409, ErrorCode.VALIDATION_ERROR, 'This request is no longer in a state that allows this action');
    }
    logger.info({ stipendRequestId: request.id, action }, 'Stipend request updated by admin');
    return res.json(request);
  } catch (err) {
    next(err);
  }
});

// --- Mobilizer weekly activity reports ---
router.get('/mobilizer-reports', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    return res.json(await getAssignmentMobilizerReports({ page, limit }));
  } catch (err) {
    next(err);
  }
});

router.patch('/mobilizer-reports/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, adminNote } = req.body;
    if (action !== 'review' && action !== 'action') {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'action must be review or action');
    }
    const report = await updateMobilizerReportStatus(req.params.id, action === 'review' ? 'reviewed' : 'actioned', adminNote);
    if (!report) throw new AppError(404, ErrorCode.NOT_FOUND, 'Mobilizer report not found');
    logger.info({ mobilizerReportId: report.id, action }, 'Mobilizer report updated by admin');
    return res.json(report);
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
