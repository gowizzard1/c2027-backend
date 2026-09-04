import { Router, Request, Response, NextFunction } from 'express';
import { getNews, getProducts, getSettings, getManifesto, getBiography, getPaymentMode } from '../store';

const router = Router();

router.get('/settings', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getSettings());
  } catch (err) {
    next(err);
  }
});

router.get('/news', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type } = req.query;
    return res.json(await getNews(type as string));
  } catch (err) {
    next(err);
  }
});

router.get('/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query;
    const all = await getProducts(category as string);
    return res.json(all.filter((p: any) => p.inStock));
  } catch (err) {
    next(err);
  }
});

router.get('/manifesto', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getManifesto());
  } catch (err) {
    next(err);
  }
});

router.get('/biography', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await getBiography());
  } catch (err) {
    next(err);
  }
});

router.get('/payment-mode', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ mode: await getPaymentMode() });
  } catch (err) {
    next(err);
  }
});

export default router;
