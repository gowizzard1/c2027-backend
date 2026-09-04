import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { requireAdmin } from '../middleware/auth';

const router = Router();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (_req, file, cb) => {
    // Unique filename per upload so a new photo gets a new URL. Reusing the same
    // filename made browsers serve the stale, cached image after replacing the photo.
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `candidate-photo-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Surface a clear reason instead of silently dropping the file.
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
  (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'NO_FILE', message: 'No file uploaded.' });
    }
    return res.json({ url: `/uploads/${req.file.filename}` });
  },
);

export default router;
