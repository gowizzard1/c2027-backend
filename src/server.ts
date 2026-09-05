import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load .env before anything else
dotenv.config();

import { validateEnv, env } from './lib/env';
import { errorHandler, notFoundHandler } from './lib/errors';
import { securityHeaders, generalLimiter, requestId } from './middleware/security';
import logger from './lib/logger';

import donationRoutes from './routes/donations';
import volunteerRoutes from './routes/volunteers';
import orderRoutes from './routes/orders';
import mpesaRoutes from './routes/mpesa';
import progressRoutes from './routes/progress';
import adminRoutes from './routes/admin';
import contentRoutes from './routes/content';
import uploadRoutes from './routes/upload';
import analyticsRoutes from './routes/analytics';

// ── Validate environment on startup ──────────────────────────────────
validateEnv();

const app = express();
const PORT = env().PORT;

// Railway/Vercel sit behind a reverse proxy and forward the client IP via
// X-Forwarded-For. Trust exactly one proxy hop so express-rate-limit can apply
// limits per real client without rejecting proxied requests.
app.set('trust proxy', 1);

// ── Security middleware ──────────────────────────────────────────────
app.use(securityHeaders);
app.use(requestId);

// ── CORS ─────────────────────────────────────────────────────────────
const corsOrigins = env().CORS_ORIGINS
  ? env().CORS_ORIGINS!.split(',').map(o => o.trim())
  : [env().FRONTEND_URL];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}));

// ── Body parsing ─────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Rate limiting (general) ──────────────────────────────────────────
app.use('/api/', generalLimiter);

// ── Static files ─────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '1d',
  etag: true,
}));

// ── Request logging ──────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Request');
  next();
});

// ── Public routes ────────────────────────────────────────────────────
app.use('/api/donations', donationRoutes);
app.use('/api/volunteers', volunteerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/donations/progress', progressRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/analytics', analyticsRoutes);

// ── Admin routes ─────────────────────────────────────────────────────
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);

// ── Health check ─────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env().NODE_ENV,
    uptime: Math.floor(process.uptime()),
  });
});

// ── Certificate endpoint ─────────────────────────────────────────────
app.get('/api/certificates/:receiptId', (req, res) => {
  res.json({ message: 'Certificate generated', receiptId: req.params.receiptId });
});

// ── Error handling ───────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start server ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info({ port: PORT, env: env().NODE_ENV }, '🚀 Campaign backend running');
});

export default app;
