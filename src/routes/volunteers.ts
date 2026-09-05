import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { sendVolunteerConfirmation } from '../services/notifications';
import {
  registerVolunteerRole, getVolunteerAccountByAccessToken, getVolunteerAccountByEmail,
  getVolunteerAccountById, getRoleAssignmentById, getAccountAssignments,
  setAccountPassword, recordAccountLoginSuccess, recordAccountLoginFailure,
  getAccountStipendStatus, createAccountStipendRequest,
  getAccountMobilizerDashboard, createAssignmentMobilizerReport,
  getActiveTurboPollingStation, getPollingStations,
  proposePollingStation,
} from '../store';
import { validate, volunteerSchema } from '../lib/validation';
import { authLimiter } from '../middleware/security';
import { createVolunteerSession, requireVolunteer } from '../middleware/auth';
import { AppError, ErrorCode } from '../lib/errors';
import logger from '../lib/logger';
import { TURBO_COUNTY, TURBO_CONSTITUENCY, TURBO_WARDS, isTurboWard } from '../lib/polling';

const router = Router();

const roleLabels: Record<string, string> = {
  polling_agent: 'Polling Agent',
  mobilizer: 'Mobilizer',
  social_media: 'Social Media Volunteer',
};

function selectDefaultAssignment(assignments: any[]) {
  return assignments.find(assignment => assignment.status === 'approved') || assignments[0] || null;
}

async function loadSessionContext(req: Request) {
  const session = (req as any).volunteer as { accountId: string; assignmentId: string; role: string; sessionVersion: number };
  const [account, assignment] = await Promise.all([
    getVolunteerAccountById(session.accountId),
    getRoleAssignmentById(session.assignmentId),
  ]);
  if (!account || account.sessionVersion !== session.sessionVersion) {
    throw new AppError(401, ErrorCode.SESSION_EXPIRED, 'Session expired. Please log in again.');
  }
  if (!assignment || assignment.accountId !== account.id || assignment.status === 'archived') {
    throw new AppError(403, ErrorCode.AUTHENTICATION_REQUIRED, 'This role assignment is no longer available.');
  }
  return { account, assignment };
}

/** Build one dashboard payload for an account and its currently selected role. */
async function toolkitPayload(account: any, selectedAssignment: any) {
  const assignments = await getAccountAssignments(account.id);
  const selected = assignments.find(assignment => assignment.id === selectedAssignment.id) || selectedAssignment;
  const isApproved = selected.status === 'approved';
  const approvedSocial = selected.role === 'social_media' && isApproved;
  const stipend = await getAccountStipendStatus(account.id);

  let social: { groupLink: string; shareMessage: string; shareUrl: string } | null = null;
  let mobilizer: any = null;
  const { getSettings } = await import('../store');
  const settings = await getSettings();
  if (approvedSocial) {
    social = {
      groupLink: settings.socialGroupLink || settings.whatsappLink || '',
      shareMessage: settings.socialShareMessage || '',
      shareUrl: settings.socialShareUrl || '',
    };
  }
  if (selected.role === 'mobilizer' && isApproved) {
    mobilizer = await getAccountMobilizerDashboard(selected.id);
  }

  return {
    name: account.name,
    email: account.email,
    role: selected.role,
    status: selected.status,
    county: selected.county,
    constituency: selected.constituency,
    ward: selected.ward,
    pollingStation: selected.pollingStation ? { id: selected.pollingStation.id, name: selected.pollingStation.name, ward: selected.pollingStation.ward } : null,
    selectedAssignmentId: selected.id,
    assignments: assignments.map(assignment => ({
      id: assignment.id,
      role: assignment.role,
      status: assignment.status,
      county: assignment.county,
      constituency: assignment.constituency,
      ward: assignment.ward,
      pollingStation: assignment.pollingStation ? { id: assignment.pollingStation.id, name: assignment.pollingStation.name, ward: assignment.pollingStation.ward } : null,
    })),
    isSocialMedia: selected.role === 'social_media',
    isApproved,
    approvedSocial,
    social,
    stipend,
    mobilizer,
  };
}

/** Public eligibility metadata for the controlled Turbo polling-agent form. */
router.get('/polling-config', async (_req: Request, res: Response) => {
  return res.json({ county: TURBO_COUNTY, constituency: TURBO_CONSTITUENCY, wards: TURBO_WARDS });
});

/** Public active official Turbo polling stations for the polling-agent registration form. */
router.get('/polling-stations', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getPollingStations());
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(volunteerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name, email, phone, idNumber, county, constituency, ward, role, experience,
      pollingStationId, proposedPollingStationName, proposedPollingStationWard,
    } = req.body;
    let assignedCounty = county;
    let assignedConstituency = constituency;
    let assignedWard = ward;
    let stationId: string | undefined;
    let assignedStation: { id: string; name: string; ward: string; approvalStatus: string; active: boolean } | null = null;
    let stationProposed = false;

    if (role === 'polling_agent') {
      if (county.trim().toLowerCase() !== TURBO_COUNTY.toLowerCase() || constituency.trim().toLowerCase() !== TURBO_CONSTITUENCY.toLowerCase()) {
        return res.status(400).json({
          error: 'POLLING_AGENT_LOCATION_REQUIRED',
          message: 'Polling agents must be registered for Uasin Gishu County and Turbo Constituency.',
        });
      }
      stationId = typeof pollingStationId === 'string' ? pollingStationId : '';
      let station = stationId ? await getActiveTurboPollingStation(stationId) : null;

      if (!station && proposedPollingStationName && proposedPollingStationWard) {
        if (!isTurboWard(proposedPollingStationWard)) {
          return res.status(400).json({
            error: 'POLLING_STATION_WARD_INVALID',
            message: `Choose one of the official Turbo wards: ${TURBO_WARDS.join(', ')}.`,
          });
        }
        const proposal = await proposePollingStation({
          name: proposedPollingStationName,
          ward: proposedPollingStationWard,
          proposedByEmail: email,
        });
        if (proposal.station.approvalStatus === 'rejected') {
          return res.status(400).json({
            error: 'POLLING_STATION_REJECTED',
            message: 'This proposed polling station was previously rejected. Please contact the campaign team.',
          });
        }
        station = proposal.station;
        stationId = station.id;
        stationProposed = proposal.created || station.approvalStatus === 'pending';
      }

      if (!station) {
        return res.status(400).json({
          error: 'POLLING_STATION_REQUIRED',
          message: 'Select an active official Turbo polling station, or propose a missing station under an official ward.',
        });
      }
      // The official or pending station record controls the assignment geography.
      assignedCounty = station.county;
      assignedConstituency = station.constituency;
      assignedWard = station.ward;
      assignedStation = {
        id: station.id,
        name: station.name,
        ward: station.ward,
        approvalStatus: station.approvalStatus,
        active: station.active,
      };
    }

    const result = await registerVolunteerRole({
      name, email, phone, idNumber,
      county: assignedCounty,
      constituency: assignedConstituency,
      ward: assignedWard,
      role, experience,
      pollingStationId: stationId,
    });
    if (result.duplicateRole) {
      return res.status(409).json({
        error: 'ROLE_ALREADY_EXISTS',
        message: `This email already has a ${roleLabels[role] || role} role application. You cannot register the same role twice.`,
      });
    }

    await sendVolunteerConfirmation({ phone: result.account.phone, name: result.account.name, role: roleLabels[role] || role });
    logger.info({ accountId: result.account.id, assignmentId: result.assignment.id, role, createdAccount: result.createdAccount }, 'Volunteer role registered');
    return res.status(201).json({
      success: true,
      message: result.createdAccount
        ? 'Volunteer registered successfully! The campaign team will review your role application.'
        : `Your ${roleLabels[role] || role} role application was added to your existing volunteer account.`,
      accountId: result.account.id,
      assignmentId: result.assignment.id,
      pollingStation: assignedStation ? { ...assignedStation, proposed: stationProposed } : null,
    });
  } catch (err) {
    next(err);
  }
});

/** Validate an account activation link without exposing dashboard resources. */
router.get('/activation', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    if (key.length < 20) return res.status(400).json({ error: 'INVALID_LINK', message: 'Invalid or incomplete link.' });
    const account = await getVolunteerAccountByAccessToken(key);
    if (!account) return res.status(404).json({ error: 'INVALID_LINK', message: 'This link is not valid.' });
    const assignments = await getAccountAssignments(account.id);
    if (assignments.length === 0) return res.status(403).json({ error: 'ACCOUNT_UNAVAILABLE', message: 'This volunteer account has no active role assignments.' });
    return res.json({ valid: true, name: account.name, email: account.email, needsPassword: !account.passwordHash });
  } catch (err) {
    next(err);
  }
});

/** Activate one account via invitation and enter its default role dashboard. */
router.post('/activate', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (key.length < 20) return res.status(400).json({ error: 'INVALID_LINK', message: 'Invalid activation link.' });
    if (password.length < 8) return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters.' });

    const account = await getVolunteerAccountByAccessToken(key);
    if (!account) return res.status(404).json({ error: 'INVALID_LINK', message: 'This link is not valid.' });
    if (account.passwordHash) return res.status(409).json({ error: 'ALREADY_ACTIVATED', message: 'This account already has a password. Please log in instead.' });
    const assignments = await getAccountAssignments(account.id);
    const selected = selectDefaultAssignment(assignments);
    if (!selected) return res.status(403).json({ error: 'ACCOUNT_UNAVAILABLE', message: 'This account has no active role assignments.' });

    const updatedAccount = await setAccountPassword(account.id, await bcrypt.hash(password, 10));
    const token = createVolunteerSession(updatedAccount.id, selected.id, selected.role, updatedAccount.sessionVersion);
    logger.info({ accountId: account.id }, 'Volunteer account activated');
    return res.json({ success: true, token, ...(await toolkitPayload(updatedAccount, selected)) });
  } catch (err) {
    next(err);
  }
});

/** Login once by unique email and enter the account's default role assignment. */
router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and password are required.' });

    const account = await getVolunteerAccountByEmail(email);
    if (!account || !account.passwordHash) return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    if (!await bcrypt.compare(password, account.passwordHash)) {
      await recordAccountLoginFailure(account.id);
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }
    const assignments = await getAccountAssignments(account.id);
    const selected = selectDefaultAssignment(assignments);
    if (!selected) return res.status(403).json({ error: 'ACCOUNT_UNAVAILABLE', message: 'This account has no active role assignments.' });

    const updatedAccount = await recordAccountLoginSuccess(account.id);
    const token = createVolunteerSession(updatedAccount.id, selected.id, selected.role, updatedAccount.sessionVersion);
    logger.info({ accountId: account.id, assignmentId: selected.id }, 'Volunteer account logged in');
    return res.json({ success: true, token, ...(await toolkitPayload(updatedAccount, selected)) });
  } catch (err) {
    next(err);
  }
});

/** Switch the selected role within the authenticated volunteer account. */
router.post('/switch-role', requireVolunteer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { account } = await loadSessionContext(req);
    const assignmentId = typeof req.body?.assignmentId === 'string' ? req.body.assignmentId : '';
    const assignment = await getRoleAssignmentById(assignmentId);
    if (!assignment || assignment.accountId !== account.id || assignment.status === 'archived') {
      return res.status(403).json({ error: 'ROLE_UNAVAILABLE', message: 'That role is not available in this account.' });
    }
    const token = createVolunteerSession(account.id, assignment.id, assignment.role, account.sessionVersion);
    return res.json({ success: true, token, ...(await toolkitPayload(account, assignment)) });
  } catch (err) {
    next(err);
  }
});

/** Submit one aggregate weekly report for the selected approved mobilizer assignment. */
router.post('/mobilizer/report', requireVolunteer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { assignment } = await loadSessionContext(req);
    if (assignment.status !== 'approved' || assignment.role !== 'mobilizer') {
      throw new AppError(403, ErrorCode.AUTHENTICATION_REQUIRED, 'Weekly reports are available to approved mobilizer roles only.');
    }
    const peopleReached = Number(req.body?.peopleReached || 0);
    const meetingsHeld = Number(req.body?.meetingsHeld || 0);
    const newVolunteers = Number(req.body?.newVolunteers || 0);
    const keyIssues = typeof req.body?.keyIssues === 'string' ? req.body.keyIssues.trim() : '';
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    if ([peopleReached, meetingsHeld, newVolunteers].some(value => !Number.isInteger(value) || value < 0 || value > 100000) || keyIssues.length > 1000 || notes.length > 2000) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Please provide valid aggregate counts and concise notes.');
    }
    const report = await createAssignmentMobilizerReport(assignment.id, { peopleReached, meetingsHeld, newVolunteers, keyIssues: keyIssues || undefined, notes: notes || undefined });
    if (!report) return res.status(409).json({ error: 'REPORT_EXISTS', message: 'You have already submitted a report for this week.' });
    const { account } = await loadSessionContext(req);
    return res.status(201).json({ success: true, report, ...(await toolkitPayload(account, assignment)) });
  } catch (err) {
    next(err);
  }
});

/** Request a person-level stipend; multiple roles never create multiple eligibility timelines. */
router.post('/stipend/request', requireVolunteer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { account } = await loadSessionContext(req);
    const eligibility = await getAccountStipendStatus(account.id);
    if (!eligibility.canRequest) return res.status(429).json({ error: 'STIPEND_NOT_ELIGIBLE', message: eligibility.reason, nextEligibleAt: eligibility.nextEligibleAt });
    const request = await createAccountStipendRequest(account.id);
    logger.info({ accountId: account.id, stipendRequestId: request.id }, 'Mobile-data stipend requested');
    return res.status(201).json({ success: true, request, stipend: await getAccountStipendStatus(account.id) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireVolunteer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { account, assignment } = await loadSessionContext(req);
    return res.json(await toolkitPayload(account, assignment));
  } catch (err) {
    next(err);
  }
});

export default router;
