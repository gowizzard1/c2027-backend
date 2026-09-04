import { z } from 'zod';

/**
 * Environment variable validation — fails fast on startup if required vars are missing.
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Server
  PORT: z.string().default('5001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Admin
  ADMIN_USERNAME: z.string().min(3, 'ADMIN_USERNAME must be at least 3 characters'),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // M-Pesa (optional — mock mode if not set)
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().url().optional(),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),

  // Flutterwave (optional)
  FLW_SECRET_KEY: z.string().optional(),
  FLW_PUBLIC_KEY: z.string().optional(),
  FLW_ENCRYPTION_KEY: z.string().optional(),

  // Africa's Talking (optional)
  AT_API_KEY: z.string().optional(),
  AT_USERNAME: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),

  // WhatsApp (optional)
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_ID: z.string().optional(),

  // Frontend
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // CORS (comma-separated origins)
  CORS_ORIGINS: z.string().optional(),

  // Object storage (S3-compatible: Cloudflare R2 or AWS S3).
  // When all required values are set, uploads go to the bucket; otherwise they
  // fall back to local disk (fine for local dev, not for production).
  S3_ENDPOINT: z.string().url().optional(),       // R2: https://<account>.r2.cloudflarestorage.com  (omit for AWS S3)
  S3_REGION: z.string().optional(),               // R2: "auto"; AWS: e.g. "eu-west-1"
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().url().optional(),      // Public base URL for objects, e.g. https://pub-xxxx.r2.dev or CDN domain

  // Email (SMTP) for volunteer invites. When unset, invite emails are logged, not sent.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  _env = result.data;
  return _env;
}

export function env(): Env {
  if (!_env) {
    throw new Error('env() called before validateEnv(). Call validateEnv() at startup.');
  }
  return _env;
}
