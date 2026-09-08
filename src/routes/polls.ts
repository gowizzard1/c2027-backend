import { Router, Request, Response, NextFunction } from 'express';
import { opinionPollVoteSchema, validate } from '../lib/validation';
import { pollVoteLimiter } from '../middleware/security';
import { castAnonymousOpinionPollVote, getAnonymousOpinionPollVoteStatus } from '../store';
import { AppError, ErrorCode } from '../lib/errors';
import { getOriginalClientIp } from '../lib/client-ip';

const router = Router();

/** Returns current results plus whether this browser/network already voted. */
router.get('/:slug/vote-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
    const tokenHeader = req.headers['x-poll-browser-token'];
    const browserToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    const result = await getAnonymousOpinionPollVoteStatus(slug, browserToken, getOriginalClientIp(req));
    if (result.state === 'unavailable') throw new AppError(404, ErrorCode.NOT_FOUND, 'This poll is not available.');
    return res.json({ hasVoted: result.hasVoted, poll: result.poll });
  } catch (err) {
    next(err);
  }
});

/**
 * Records one anonymous vote per browser token for the active poll round.
 * This is intentionally browser-limited rather than identity-verified.
 */
router.post('/:slug/votes', pollVoteLimiter, validate(opinionPollVoteSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
    const requestIp = getOriginalClientIp(req);
    const result = await castAnonymousOpinionPollVote(slug, req.body.optionId, req.body.browserToken, requestIp);
    if (result.state === 'unavailable') throw new AppError(404, ErrorCode.NOT_FOUND, 'This poll is not currently open for voting.');
    if (result.state === 'invalid_option') throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Choose an option from this poll.');
    if (result.state === 'duplicate') {
      return res.status(409).json({ error: ErrorCode.DUPLICATE_REQUEST, message: 'This browser has already voted in the current poll round.', poll: result.poll });
    }
    return res.status(201).json({ success: true, poll: result.poll });
  } catch (err) {
    next(err);
  }
});

export default router;
