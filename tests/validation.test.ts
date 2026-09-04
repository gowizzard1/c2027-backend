import { describe, it, expect } from 'vitest';
import {
  donationSchema,
  volunteerSchema,
  orderSchema,
  loginSchema,
} from '../src/lib/validation';

describe('Donation Schema', () => {
  it('accepts valid M-Pesa donation', () => {
    const result = donationSchema.safeParse({
      amount: 1000,
      paymentMethod: 'mpesa',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '0712345678',
    });
    expect(result.success).toBe(true);
  });

  it('accepts string amounts (coerced)', () => {
    const result = donationSchema.safeParse({
      amount: '5000',
      paymentMethod: 'mpesa',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '0712345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative amounts', () => {
    const result = donationSchema.safeParse({
      amount: -100,
      paymentMethod: 'mpesa',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '0712345678',
    });
    expect(result.success).toBe(false);
  });

  it('rejects amounts over 500,000', () => {
    const result = donationSchema.safeParse({
      amount: 600000,
      paymentMethod: 'mpesa',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '0712345678',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = donationSchema.safeParse({
      amount: 1000,
      paymentMethod: 'mpesa',
      name: 'John Doe',
      email: 'not-an-email',
      phone: '0712345678',
    });
    expect(result.success).toBe(false);
  });

  it('rejects too-short phone', () => {
    const result = donationSchema.safeParse({
      amount: 1000,
      paymentMethod: 'mpesa',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '07',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid card donation', () => {
    const result = donationSchema.safeParse({
      amount: 2500,
      paymentMethod: 'card',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '0712345678',
      transactionId: 'FLW-TXN-12345',
    });
    expect(result.success).toBe(true);
  });

  it('rejects card donation without transactionId', () => {
    const result = donationSchema.safeParse({
      amount: 2500,
      paymentMethod: 'card',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '0712345678',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid payment method', () => {
    const result = donationSchema.safeParse({
      amount: 1000,
      paymentMethod: 'paypal',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '0712345678',
    });
    expect(result.success).toBe(false);
  });
});

describe('Volunteer Schema', () => {
  it('accepts valid volunteer registration', () => {
    const result = volunteerSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      phone: '0712345678',
      idNumber: '12345678',
      county: 'Nairobi',
      constituency: 'Westlands',
      ward: 'Parklands',
      role: 'polling_agent',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid role', () => {
    const result = volunteerSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      phone: '0712345678',
      idNumber: '12345678',
      county: 'Nairobi',
      constituency: 'Westlands',
      ward: 'Parklands',
      role: 'invalid_role',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional experience', () => {
    const result = volunteerSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
      phone: '0712345678',
      idNumber: '12345678',
      county: 'Nairobi',
      constituency: 'Westlands',
      ward: 'Parklands',
      role: 'mobilizer',
      experience: '5 years in community organizing',
    });
    expect(result.success).toBe(true);
  });
});

describe('Order Schema', () => {
  it('accepts valid order', () => {
    const result = orderSchema.safeParse({
      items: [{ id: 'abc', name: 'T-Shirt', price: 500, quantity: 2 }],
      total: 1000,
      name: 'John Doe',
      phone: '0712345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty items array', () => {
    const result = orderSchema.safeParse({
      items: [],
      total: 0,
      name: 'John Doe',
      phone: '0712345678',
    });
    expect(result.success).toBe(false);
  });
});

describe('Login Schema', () => {
  it('accepts valid credentials', () => {
    const result = loginSchema.safeParse({
      username: 'admin',
      password: 'secret',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty username', () => {
    const result = loginSchema.safeParse({
      username: '',
      password: 'secret',
    });
    expect(result.success).toBe(false);
  });
});
