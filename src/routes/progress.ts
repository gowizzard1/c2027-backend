import { Router, Request, Response, NextFunction } from 'express';
import { getDonationProgress } from '../store';

const router = Router();

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const progress = await getDonationProgress();
    return res.json(progress);
  } catch (err) {
    next(err);
  }
});

export default router;
