import { Router, Request, Response } from 'express';
import { updateDonationStatus } from '../store';
import { sendDonationConfirmation } from '../services/notifications';
import logger from '../lib/logger';

const router = Router();

// Track processed callbacks to prevent duplicates
const processedCallbacks = new Set<string>();

router.post('/callback', async (req: Request, res: Response) => {
  try {
    const { Body } = req.body;
    if (!Body?.stkCallback) {
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = Body.stkCallback;

    // Deduplication check
    if (processedCallbacks.has(CheckoutRequestID)) {
      logger.info({ CheckoutRequestID }, 'Duplicate M-Pesa callback — skipping');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    processedCallbacks.add(CheckoutRequestID);

    // Clean up old entries (keep last 1000)
    if (processedCallbacks.size > 1000) {
      const entries = Array.from(processedCallbacks);
      for (let i = 0; i < entries.length - 500; i++) {
        processedCallbacks.delete(entries[i]);
      }
    }

    if (ResultCode === 0) {
      const metadata = CallbackMetadata?.Item || [];
      const amount = metadata.find((m: any) => m.Name === 'Amount')?.Value;
      const mpesaReceiptNumber = metadata.find((m: any) => m.Name === 'MpesaReceiptNumber')?.Value;

      logger.info({ CheckoutRequestID, amount, mpesaReceiptNumber }, 'M-Pesa payment successful');

      const donation = await updateDonationStatus(CheckoutRequestID, 'completed', mpesaReceiptNumber);
      if (donation) {
        await sendDonationConfirmation({
          phone: donation.phone,
          name: donation.name,
          amount: donation.amount,
          receiptId: donation.id,
        });
      }
    } else {
      logger.warn({ CheckoutRequestID, ResultCode, ResultDesc }, 'M-Pesa payment failed');
      await updateDonationStatus(CheckoutRequestID, 'failed');
    }

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    logger.error({ err: error }, 'M-Pesa callback processing error');
    // Always respond 200 to Safaricom to prevent retries
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

export default router;
