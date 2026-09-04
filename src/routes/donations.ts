import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { initiateSTKPush, mockSTKPush, isMpesaConfigured } from '../services/mpesa';
import { verifyTransaction, mockVerifyTransaction, isCardConfigured, getPublicKey } from '../services/card';
import { sendDonationConfirmation } from '../services/notifications';
import { addDonation, getPaymentMode, addPledge } from '../store';
import { validate, donationSchema, pledgeSchema } from '../lib/validation';
import { AppError, ErrorCode } from '../lib/errors';
import { idempotencyCheck } from '../middleware/idempotency';
import { paymentLimiter } from '../middleware/security';
import logger from '../lib/logger';

const router = Router();

/**
 * GET /api/donations/config
 * Returns the Flutterwave public key for the frontend Inline modal.
 * No sensitive data is exposed here — public keys are designed to be client-facing.
 */
router.get('/config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const mode = await getPaymentMode();
    return res.json({
      flutterwavePublicKey: mode === 'mock' ? '' : getPublicKey(),
      isMock: mode === 'mock',
      cardEnabled: isCardConfigured() || mode === 'mock',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/donations/pledge
 * Capture a donor's interest while online payments are still being integrated.
 * No money moves — we simply record the person so the campaign can contact them
 * once real payments are ready.
 */
router.post(
  '/pledge',
  paymentLimiter,
  validate(pledgeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email, phone, amount, message } = req.body;
      const id = 'PLG-' + uuidv4().slice(0, 8).toUpperCase();

      await addPledge({ id, name, email, phone, amount, message });

      logger.info({ pledgeId: id, amount: amount ?? null }, 'Donation pledge captured');

      return res.json({
        success: true,
        pledgeId: id,
        message:
          'Thank you for your willingness to donate. We are currently setting things up and will let you know as soon as we are ready.',
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/donations
 * Process a donation — either M-Pesa STK push or card (Flutterwave Inline verification).
 */
router.post(
  '/',
  paymentLimiter,
  idempotencyCheck,
  validate(donationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, paymentMethod, name, email, phone } = req.body;

      const receiptId = 'RCP-' + uuidv4().slice(0, 8).toUpperCase();
      const mode = await getPaymentMode();
      const useMock = mode === 'mock';

      // ── M-PESA ──────────────────────────────────────────────
      if (paymentMethod === 'mpesa') {
        const stkFn = (useMock || !isMpesaConfigured()) ? mockSTKPush : initiateSTKPush;

        try {
          const stkResult = await stkFn({
            phone,
            amount: Number(amount),
            accountRef: 'MP2027',
            description: 'MP Campaign Donation',
          });

          await addDonation({
            id: receiptId,
            amount: Number(amount),
            name,
            email,
            phone,
            paymentMethod: 'mpesa',
            status: stkResult.mock ? 'completed' : 'pending',
            mpesaRequestId: stkResult.CheckoutRequestID,
          });

          if (stkResult.mock) {
            await sendDonationConfirmation({ phone, name, amount: Number(amount), receiptId });
          }

          logger.info({ receiptId, amount, method: 'mpesa', mock: !!stkResult.mock }, 'Donation initiated');

          return res.json({
            success: true,
            receiptId,
            mock: stkResult.mock || false,
            message: stkResult.mock
              ? 'Mock payment processed successfully.'
              : 'STK push sent. Please enter your M-Pesa PIN to complete payment.',
            checkoutRequestId: stkResult.CheckoutRequestID,
          });
        } catch (err: any) {
          logger.error({ err, phone, amount }, 'M-Pesa STK push failed');
          throw new AppError(
            502,
            ErrorCode.MPESA_ERROR,
            err?.response?.data?.errorMessage || 'M-Pesa request failed. Please try again.',
          );
        }
      }

      // ── CARD (Flutterwave Inline — verify transaction) ─────
      if (paymentMethod === 'card') {
        const { transactionId } = req.body;

        const verifyFn = (useMock || !isCardConfigured()) ? mockVerifyTransaction : verifyTransaction;

        try {
          const result = await verifyFn(transactionId);

          if (result.status === 'success') {
            // Verify amount matches what the user declared (prevent tampering)
            if (!useMock && result.amount !== Number(amount)) {
              logger.warn(
                { transactionId, expected: amount, actual: result.amount },
                'Card amount mismatch — possible tampering',
              );
              throw new AppError(
                400,
                ErrorCode.CARD_ERROR,
                'Payment amount does not match. Please contact support.',
              );
            }

            await addDonation({
              id: receiptId,
              amount: Number(amount),
              name,
              email,
              phone,
              paymentMethod: 'card',
              status: 'completed',
            });

            await sendDonationConfirmation({ phone, name, amount: Number(amount), receiptId });
            logger.info({ receiptId, amount, method: 'card', transactionId }, 'Card donation verified and recorded');

            return res.json({
              success: true,
              receiptId,
              mock: useMock,
              message: 'Payment verified successfully!',
            });
          }

          throw new AppError(402, ErrorCode.CARD_ERROR, result.message || 'Card payment verification failed');
        } catch (err: any) {
          if (err instanceof AppError) throw err;
          logger.error({ err, transactionId, email, amount }, 'Card verification failed');
          throw new AppError(
            502,
            ErrorCode.CARD_ERROR,
            'Card payment verification failed. Please try again or contact support.',
          );
        }
      }

      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Invalid payment method. Use "mpesa" or "card".');
    } catch (err) {
      next(err);
    }
  },
);

export default router;
