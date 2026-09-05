import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from './errors';

/**
 * Middleware factory: validates request body against a Zod schema.
 */
export function validate<T extends z.ZodType>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i: any) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Invalid request data', details);
    }
    req.body = result.data;
    next();
  };
}

// ─── Shared field schemas ──────────────────────────────────────────────

export const phoneSchema = z
  .string()
  .min(9, 'Phone number is too short')
  .max(15, 'Phone number is too long')
  .regex(/^[+\d\s()-]+$/, 'Invalid phone number format');

export const emailSchema = z.string().email('Invalid email address');

export const kenyanAmountSchema = z
  .string()
  .or(z.number())
  .transform(val => Number(val))
  .refine(val => !isNaN(val) && val >= 1, 'Amount must be at least KES 1')
  .refine(val => val <= 500000, 'Amount cannot exceed KES 500,000');

// ─── Donation schemas ──────────────────────────────────────────────────

export const mpesaDonationSchema = z.object({
  amount: kenyanAmountSchema,
  paymentMethod: z.literal('mpesa'),
  name: z.string().min(2, 'Name is required').max(100),
  email: emailSchema,
  phone: phoneSchema,
});

/**
 * Card donations now use Flutterwave Inline (hosted modal).
 * The frontend sends the transaction_id from Flutterwave after payment completes.
 * No card details (PAN, CVV, expiry) ever touch our server.
 */
export const cardDonationSchema = z.object({
  amount: kenyanAmountSchema,
  paymentMethod: z.literal('card'),
  name: z.string().min(2, 'Name is required').max(100),
  email: emailSchema,
  phone: phoneSchema,
  transactionId: z.string().min(1, 'Transaction ID is required'),
});

export const donationSchema = z.union([mpesaDonationSchema, cardDonationSchema]);

// ─── Pledge schema (donation interest while payments are under integration) ──

export const pledgeSchema = z.object({
  name: z.string().min(2, 'Name is required').max(100),
  email: emailSchema,
  phone: phoneSchema,
  // Optional intended amount — a pledge, not a real charge.
  amount: z
    .string()
    .or(z.number())
    .transform(val => (val === '' || val === null || val === undefined ? undefined : Number(val)))
    .refine(val => val === undefined || (!isNaN(val) && val >= 1 && val <= 500000), 'Amount must be between KES 1 and 500,000')
    .optional(),
  message: z.string().max(500).optional(),
});

// ─── Volunteer schema ──────────────────────────────────────────────────

export const volunteerSchema = z.object({
  name: z.string().min(2, 'Name is required').max(100),
  email: emailSchema,
  phone: phoneSchema,
  idNumber: z.string().min(5, 'ID number is required').max(20),
  county: z.string().min(2, 'County is required').max(50),
  constituency: z.string().min(2).max(50),
  ward: z.string().min(2).max(50),
  role: z.enum(['polling_agent', 'mobilizer', 'social_media']),
  pollingStationId: z.string().min(1).max(100).optional(),
  experience: z.string().max(500).optional(),
});

// ─── Order schema ──────────────────────────────────────────────────────

export const orderSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    name: z.string(),
    price: z.number().min(0),
    quantity: z.number().int().min(1),
    size: z.string().optional(),
  })).min(1, 'At least one item is required'),
  total: z.string().or(z.number()).transform(val => Number(val)).refine(val => val >= 1, 'Total must be at least KES 1'),
  name: z.string().min(2).max(100).default('Customer'),
  phone: phoneSchema,
  deliveryAddress: z.string().max(200).optional(),
});

// ─── Admin schemas ─────────────────────────────────────────────────────

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const newsSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000).optional().default(''),
  category: z.string().max(50).optional().default('General'),
  type: z.enum(['news', 'event', 'photo']),
  image: z.string().max(500).optional(),
  emoji: z.string().max(10).optional(),
  time: z.string().max(50).optional(),
  location: z.string().max(100).optional(),
});

export const productSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  price: z.string().or(z.number()).transform(val => Number(val)).refine(val => val >= 1, 'Price must be at least KES 1'),
  image: z.string().max(500).optional().default('📦'),
  category: z.string().max(50).optional().default('General'),
  sizes: z.array(z.string()).optional(),
});

export const manifestoSchema = z.object({
  pillar: z.string().min(1, 'Pillar is required').max(100),
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().min(1, 'Description is required').max(1000),
  details: z.string().max(5000).optional(),
  icon: z.string().max(10).optional().default('📌'),
  sortOrder: z.string().or(z.number()).transform(val => Number(val)).refine(val => Number.isInteger(val) && val >= 0, 'Sort order must be a non-negative integer').optional().default('0' as any),
});

export const settingsSchema = z.object({
  siteName: z.string().max(100).optional(),
  tagline: z.string().max(200).optional(),
  heroTitle: z.string().max(200).optional(),
  heroSubtitle: z.string().max(500).optional(),
  // Accept empty string (form default) as "not set" so a full-form save never fails.
  donationGoal: z
    .string()
    .or(z.number())
    .transform(val => (val === '' || val === null || val === undefined ? undefined : Number(val)))
    .refine(val => val === undefined || val >= 1000, 'Goal must be at least KES 1000')
    .optional(),
  whatsappLink: z.string().max(200).optional(),
  // Optional contact fields may be left blank in the admin form.
  contactEmail: z.union([z.literal(''), emailSchema]).optional(),
  contactPhone: z.union([z.literal(''), phoneSchema]).optional(),
  address: z.string().max(300).optional(),
  candidatePhoto: z.string().max(500).optional(),
  // Social-media volunteer team config
  socialGroupLink: z.string().max(300).optional(),
  socialShareMessage: z.string().max(500).optional(),
  socialShareUrl: z.string().max(300).optional(),
  mobilizerGroupLink: z.string().max(300).optional(),
  stipendActivationDelayDays: z
    .string()
    .or(z.number())
    .transform(val => Number(val))
    .refine(val => Number.isInteger(val) && val >= 0 && val <= 90, 'Stipend activation delay must be a whole number from 0 to 90 days')
    .optional(),
  visionItems: z.array(z.object({
    icon: z.string(),
    title: z.string(),
    description: z.string(),
  })).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one setting field is required',
});
