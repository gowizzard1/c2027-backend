import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sendVolunteerConfirmation } from '../services/notifications';
import { addVolunteer } from '../store';
import { validate, volunteerSchema } from '../lib/validation';
import logger from '../lib/logger';

const router = Router();

const roleLabels: Record<string, string> = {
  polling_agent: 'Polling Agent',
  mobilizer: 'Mobilizer',
  social_media: 'Social Media Volunteer',
};

router.post('/', validate(volunteerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, idNumber, county, constituency, ward, role, experience } = req.body;

    const id = uuidv4();
    await addVolunteer({ id, name, email, phone, idNumber, county, constituency, ward, role, experience });

    await sendVolunteerConfirmation({ phone, name, role: roleLabels[role] || role });

    logger.info({ volunteerId: id, role, county }, 'Volunteer registered');

    return res.json({ success: true, message: 'Volunteer registered successfully!', volunteerId: id });
  } catch (err) {
    next(err);
  }
});

export default router;
