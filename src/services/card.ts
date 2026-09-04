import axios from 'axios';
import logger from '../lib/logger';

function isConfigured(): boolean {
  const key = process.env.FLW_SECRET_KEY || '';
  return !!(key && !key.startsWith('your_') && key.startsWith('FLWSECK'));
}

function getPublicKey(): string {
  return process.env.FLW_PUBLIC_KEY || '';
}

export interface VerifyTransactionResult {
  status: 'success' | 'failed';
  transactionId: string;
  amount: number;
  currency: string;
  email: string;
  name: string;
  txRef: string;
  message: string;
}

/**
 * Verify a completed Flutterwave transaction by its ID.
 * Called after the frontend Flutterwave Inline modal completes.
 */
export async function verifyTransaction(transactionId: string): Promise<VerifyTransactionResult> {
  if (!isConfigured()) {
    throw new Error('Flutterwave not configured');
  }

  const res = await axios.get(
    `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
    { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } },
  );

  const data = res.data;

  if (data.status === 'success' && data.data?.status === 'successful') {
    return {
      status: 'success',
      transactionId: String(data.data.id),
      amount: data.data.amount,
      currency: data.data.currency,
      email: data.data.customer?.email || '',
      name: data.data.customer?.name || '',
      txRef: data.data.tx_ref,
      message: 'Payment verified successfully',
    };
  }

  logger.warn({ transactionId, flwStatus: data.data?.status }, 'Transaction verification failed');
  return {
    status: 'failed',
    transactionId: String(transactionId),
    amount: data.data?.amount || 0,
    currency: data.data?.currency || 'KES',
    email: data.data?.customer?.email || '',
    name: data.data?.customer?.name || '',
    txRef: data.data?.tx_ref || '',
    message: data.data?.processor_response || 'Payment verification failed',
  };
}

/**
 * Mock transaction verification — simulates a successful payment.
 */
export async function mockVerifyTransaction(transactionId: string): Promise<VerifyTransactionResult> {
  logger.info({ transactionId }, '[Card MOCK] Verifying transaction');
  await new Promise(r => setTimeout(r, 300));
  return {
    status: 'success',
    transactionId,
    amount: 0, // Will be overridden by the stored amount
    currency: 'KES',
    email: '',
    name: '',
    txRef: `MOCK-REF-${Date.now()}`,
    message: 'Mock payment verified',
  };
}

export { isConfigured as isCardConfigured, getPublicKey };
