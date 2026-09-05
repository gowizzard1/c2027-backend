import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
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

function parseUpload(fieldName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(fieldName)(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'Image must be 5MB or smaller.' });
        }
        return res.status(400).json({ error: 'UPLOAD_FAILED', message: err.message || 'Upload failed.' });
      }
      next();
    });
  };
}

async function storePublicImage(file: Express.Multer.File, prefix: string) {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const filename = `${prefix}-${crypto.randomUUID()}${ext}`;
  if (isObjectStorageConfigured()) {
    return putObject(filename, file.buffer, file.mimetype);
  }
  const localPath = path.join(UPLOADS_DIR, filename);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, file.buffer);
  return `/uploads/${filename}`;
}

router.post(
  '/candidate-photo',
  requireAdmin,
  parseUpload('photo'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'NO_FILE', message: 'No file uploaded.' });
    }

    try {
      const url = await storePublicImage(req.file, 'candidate-photo');
      return res.json({ url });
    } catch (err) {
      logger.error({ err }, 'Failed to store uploaded file');
      return res.status(500).json({ error: 'STORAGE_ERROR', message: 'Could not save the image. Please try again.' });
    }
  },
);

// Candidate portrait for the election result registry. Public campaign media, not private evidence.
router.post(
  '/candidate-image',
  requireAdmin,
  parseUpload('image'),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE', message: 'No image uploaded.' });
    try {
      const url = await storePublicImage(req.file, 'candidate-images/candidate');
      return res.status(201).json({ url });
    } catch (err) {
      logger.error({ err }, 'Failed to store candidate image');
      return res.status(500).json({ error: 'STORAGE_ERROR', message: 'Could not save the candidate image. Please try again.' });
    }
  },
);

export default router;