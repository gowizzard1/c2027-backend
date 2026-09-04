import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { sendVolunteerConfirmation } from '../services/notifications';
import {
  addVolunteer, findVolunteerByAccessToken, findVolunteerByEmail,
  getVolunteerById, setVolunteerPassword, getSettings,
} from '../store';
import { validate, volunteerSchema } from '../lib/validation';
import { authLimiter } from '../middleware/security';
import { createVolunteerSession, requireVolunteer } from '../middleware/auth';
import { AppError, ErrorCode } from '../lib/errors';
import logger from '../lib/logger';

const router = Router();

const roleLabels: Record<string, string> = {
  polling_agent: 'Polling Agent',
  mobilizer: 'Mobilizer',
  social_media: 'Social Media Volunteer',
};

function generateAccessToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/** Shape the authenticated toolkit payload for a volunteer, gating social content. */
async function toolkitPayload(volunteer: any) {
  const approvedSocial = volunteer.role === 'social_media' && volunteer.status === 'approved';
  let social: { groupLink: string; shareMessage: string; shareUrl: string } | null = null;
  if (approvedSocial) {
    const settings = await getSettings();
    social = {
      groupLink: settings.socialGroupLink || '',
      shareMessage: settings.socialShareMessage || '',
      shareUrl: settings.socialShareUrl || '',
    };
  }
  return {
    name: volunteer.name,
    email: volunteer.email,
    role: volunteer.role,
    status: volunteer.status,
    isSocialMedia: volunteer.role === 'social_media',
    isApproved: volunteer.status === 'approved',
    approvedSocial,
    social,
  };
}

router.post('/', validate(volunteerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, idNumber, county, constituency, ward, role, experience } = req.body;
    const id = uuidv4();
    const accessToken = generateAccessToken();
    await addVolunteer({ id, name, email, phone, idNumber, county, constituency, ward, role, experience, accessToken });
    await sendVolunteerConfirmation({ phone, name, role: roleLabels[role] || role });
    logger.info({ volunteerId: id, role, county }, 'Volunteer registered');
    return res.json({ success: true, message: 'Volunteer registered successfully!', volunteerId: id });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/volunteers/activation?key=<accessToken>
 * Validates an invite/activation link and reports whether the volunteer still
 * needs to set a password. Returns only their name + email (to prefill) — no
 * gated content until they authenticate.
 */
router.get('/activation', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    if (key.length < 20) {
      return res.status(400).json({ error: 'INVALID_LINK', message: 'Invalid or incomplete link.' });
    }
    const volunteer = await findVolunteerByAccessToken(key);
    if (!volunteer) {
      return res.status(404).json({ error: 'INVALID_LINK', message: 'This link is not valid.' });
    }
    return res.json({
      valid: true,
      name: volunteer.name,
      email: volunteer.email,
      needsPassword: !volunteer.passwordHash,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/volunteers/activate  { key, password }
 * Sets the volunteer's password via their invite link, then logs them in.
 * The link stays valid but activation only sets a password if one isn't set yet
 * (to reset, the admin regenerates the token).
 */
router.post('/activate', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (key.length < 20) {
      return res.status(400).json({ error: 'INVALID_LINK', message: 'Invalid activation link.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters.' });
    }

    const volunteer = await findVolunteerByAccessToken(key);
    if (!volunteer) {
      return res.status(404).json({ error: 'INVALID_LINK', message: 'This link is not valid.' });
    }
    if (volunteer.passwordHash) {
      return res.status(409).json({ error: 'ALREADY_ACTIVATED', message: 'This account already has a password. Please log in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await setVolunteerPassword(volunteer.id, passwordHash);
    const token = createVolunteerSession(volunteer.id, volunteer.role);
    logger.info({ volunteerId: volunteer.id }, 'Volunteer account activated');

    return res.json({ success: true, token, ...(await toolkitPayload(volunteer)) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/volunteers/login  { email, password }
 * Email + password login for an activated volunteer.
 */
router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and password are required.' });
    }

    const volunteer = await findVolunteerByEmail(email);
    // Generic error to avoid revealing which part failed.
    if (!volunteer || !volunteer.passwordHash) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }
    const ok = await bcrypt.compare(password, volunteer.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }

    const token = createVolunteerSession(volunteer.id, volunteer.role);
    logger.info({ volunteerId: volunteer.id }, 'Volunteer logged in');
    return res.json({ success: true, token, ...(await toolkitPayload(volunteer)) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/volunteers/me  (requires volunteer JWT)
 * Returns the authenticated volunteer's toolkit (gated social content).
 */
router.get('/me', requireVolunteer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = (req as any).volunteer as { id: string };
    const volunteer = await getVolunteerById(id);
    if (!volunteer) throw new AppError(404, ErrorCode.NOT_FOUND, 'Volunteer record not found.');
    return res.json(await toolkitPayload(volunteer));
  } catch (err) {
    next(err);
  }
});

export default router;
