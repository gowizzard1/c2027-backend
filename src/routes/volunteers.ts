import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { sendVolunteerConfirmation } from '../services/notifications';
import {
  addVolunteer, findVolunteerByAccessToken, getSettings,
} from '../store';
import { validate, volunteerSchema } from '../lib/validation';
import { authLimiter } from '../middleware/security';
import logger from '../lib/logger';

const router = Router();

const roleLabels: Record<string, string> = {
  polling_agent: 'Polling Agent',
  mobilizer: 'Mobilizer',
  social_media: 'Social Media Volunteer',
};

/** Generate an unguessable access token for the secret toolkit link. */
function generateAccessToken(): string {
  return crypto.randomBytes(24).toString('base64url'); // ~32 url-safe chars
}

router.post('/', validate(volunteerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, idNumber, county, constituency, ward, role, experience } = req.body;

    const id = uuidv4();
    // Every volunteer gets a unique access token up front; it only unlocks the
    // toolkit once an admin approves them as a social-media volunteer.
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
 * GET /api/volunteers/toolkit?key=<accessToken>
 * Opens the social-media volunteer toolkit via their unique secret link (which the
 * admin sends them manually after approval). The group invite + share content are
 * only returned if the volunteer is an APPROVED social-media volunteer — otherwise
 * the link is valid but the toolkit stays locked with an appropriate message.
 * Rate-limited to discourage token guessing.
 */
router.get('/toolkit', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    if (key.length < 20) {
      return res.status(400).json({ error: 'INVALID_LINK', message: 'Invalid or incomplete access link.' });
    }

    const volunteer = await findVolunteerByAccessToken(key);
    if (!volunteer) {
      return res.status(404).json({ error: 'INVALID_LINK', message: 'This access link is not valid.' });
    }

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

    return res.json({
      name: volunteer.name,
      role: volunteer.role,
      status: volunteer.status,
      isSocialMedia: volunteer.role === 'social_media',
      isApproved: volunteer.status === 'approved',
      approvedSocial,
      social, // null unless approved social-media volunteer — link is gated here
    });
  } catch (err) {
    next(err);
  }
});

export default router;
