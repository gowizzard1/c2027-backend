import { Router, Request, Response, NextFunction } from 'express';
import { opinionPollVoteSchema, validate } from '../lib/validation';
import { pollVoteLimiter } from '../middleware/security';
import { castAnonymousOpinionPollVote } from '../store';
import { AppError, ErrorCode } from '../lib/errors';

const router = Router();

/**
 * Records one anonymous vote per browser token for the active poll round.
 * This is intentionally browser-limited rather than identity-verified.
 */
router.post('/:slug/votes', pollVoteLimiter, validate(opinionPollVoteSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
    const requestIp = req.ip || req.socket.remoteAddress || 'unknown';
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
