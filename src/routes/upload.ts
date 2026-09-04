import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { requireAdmin } from '../middleware/auth';
import { isObjectStorageConfigured, putObject } from '../services/storage';
import logger from '../lib/logger';

const router = Router();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Keep the file in memory so we can push it to object storage or write to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload a JPEG, PNG, or WebP image.'));
    }
  },
});

router.post(
  '/candidate-photo',
  requireAdmin,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('photo')(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'Image must be 5MB or smaller.' });
        }
        return res.status(400).json({ error: 'UPLOAD_FAILED', message: err.message || 'Upload failed.' });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'NO_FILE', message: 'No file uploaded.' });
    }

    // Unique filename so a replaced photo gets a fresh URL (avoids stale browser cache).
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `candidate-photo-${Date.now()}${ext}`;

    try {
      if (isObjectStorageConfigured()) {
        // Production path: durable object storage (R2 / S3). Returns an absolute URL.
        const url = await putObject(filename, req.file.buffer, req.file.mimetype);
        return res.json({ url });
      }

      // Fallback: local disk (dev only — not durable across redeploys).
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      await fs.writeFile(path.join(UPLOADS_DIR, filename), req.file.buffer);
      return res.json({ url: `/uploads/${filename}` });
    } catch (err) {
      logger.error({ err }, 'Failed to store uploaded file');
      return res.status(500).json({ error: 'STORAGE_ERROR', message: 'Could not save the image. Please try again.' });
    }
  },
);

export default router;
