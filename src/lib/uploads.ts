import path from 'path';

/**
 * Public campaign media. Configure PUBLIC_UPLOADS_DIR to a Railway Volume path
 * such as /data/uploads in production. Local development uses backend/uploads.
 */
export function getPublicUploadsDir() {
  return process.env.PUBLIC_UPLOADS_DIR || path.join(__dirname, '../../uploads');
}
