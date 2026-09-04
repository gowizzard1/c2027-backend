/**
 * Object storage for uploads. S3-compatible — works with Cloudflare R2 or AWS S3.
 *
 * When the S3_* env vars are configured, files are uploaded to the bucket and a
 * public URL is returned. When they are not configured, callers fall back to
 * local disk (see routes/upload.ts) — acceptable for local dev only.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import logger from '../lib/logger';

let client: S3Client | null = null;

/**
 * True when all required object-storage settings are present.
 * S3_ENDPOINT is optional (only needed for R2 / non-AWS providers).
 */
export function isObjectStorageConfigured(): boolean {
  return !!(
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    process.env.S3_PUBLIC_URL
  );
}

function getClient(): S3Client {
  if (client) return client;

  client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    // Cloudflare R2 (and other S3-compatible providers) require a custom endpoint.
    // AWS S3 works with just region, so leave S3_ENDPOINT unset for AWS.
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    // R2 requires path-style addressing.
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });

  return client;
}

/**
 * Upload a buffer and return its public URL.
 * @param key      Object key (path within the bucket), e.g. "candidate-photo-123.jpg"
 * @param body     File contents
 * @param contentType MIME type, e.g. "image/jpeg"
 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  if (!isObjectStorageConfigured()) {
    throw new Error('Object storage is not configured');
  }

  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: body,
      ContentType: contentType,
      // 1 year immutable cache — safe because each upload uses a unique key.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  const base = process.env.S3_PUBLIC_URL!.replace(/\/+$/, '');
  const url = `${base}/${key}`;
  logger.info({ key, bucket: process.env.S3_BUCKET }, 'Uploaded object to storage');
  return url;
}
