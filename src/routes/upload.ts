import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { requireAdmin } from '../middleware/auth';
import { isObjectStorageConfigured, isPrivateObjectStorageConfigured, putObject, putPrivateObject } from '../services/storage';
import logger from '../lib/logger';

const router = Router();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_APK_BYTES = 120 * 1024 * 1024; // 120MB
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

const apkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_APK_BYTES },
  fileFilter: (_req, file, cb) => {
    const isApk = path.extname(file.originalname).toLowerCase() === '.apk';
    if (!isApk) {
      cb(new Error('Only Android APK files can be uploaded.'));
      return;
    }
    cb(null, true);
  },
});

function parseApkUpload(fieldName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    apkUpload.single(fieldName)(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'APK_TOO_LARGE', message: 'APK must be 120MB or smaller.' });
        }
        return res.status(400).json({ error: 'APK_UPLOAD_FAILED', message: err.message || 'APK upload failed.' });
      }
      next();
    });
  };
}

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

async function storePrivateApk(file: Express.Multer.File) {
  if (!isPrivateObjectStorageConfigured()) {
    throw new Error('Private app-download storage is not configured. Configure PRIVATE_S3_BUCKET and S3 credentials before publishing APK releases.');
  }
  const objectKey = `private/mobile-apps/ikm-campaign-team-${crypto.randomUUID()}.apk`;
  await putPrivateObject(objectKey, file.buffer, 'application/vnd.android.package-archive');
  return objectKey;
}

router.post(
  '/mobile-apk',
  requireAdmin,
  parseApkUpload('apk'),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE', message: 'No APK uploaded.' });
    try {
      const objectKey = await storePrivateApk(req.file);
      return res.status(201).json({ objectKey, size: req.file.size, originalName: req.file.originalname });
    } catch (err: any) {
      logger.error({ err }, 'Failed to store private mobile APK');
      return res.status(500).json({ error: 'STORAGE_ERROR', message: err?.message || 'Could not save the private APK. Please try again.' });
    }
  },
);

export default router;