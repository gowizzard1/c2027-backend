import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { initiateSTKPush, isMpesaConfigured, mockSTKPush } from '../services/mpesa';
import { sendOrderConfirmation } from '../services/notifications';
import { addOrder, getPaymentMode } from '../store';
import { validate, orderSchema } from '../lib/validation';
import { idempotencyCheck } from '../middleware/idempotency';
import { paymentLimiter } from '../middleware/security';
import logger from '../lib/logger';

const router = Router();

router.post(
  '/',
  paymentLimiter,
  idempotencyCheck,
  validate(orderSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { items, total, name, phone, deliveryAddress } = req.body;

      const orderId = 'ORD-' + uuidv4().slice(0, 8).toUpperCase();

      await addOrder({
        id: orderId,
        itemsJson: JSON.stringify(items),
        total,
        name,
        phone,
        deliveryAddress,
      });

      if (phone) {
        const mode = await getPaymentMode();
        const useMock = mode === 'mock';
        const stkFn = (useMock || !isMpesaConfigured()) ? mockSTKPush : initiateSTKPush;

        try {
          await stkFn({ phone, amount: total, accountRef: orderId, description: 'MP Campaign Merch' });
        } catch (err) {
          logger.warn({ err, orderId }, 'STK push for order failed — order still recorded');
        }

        await sendOrderConfirmation({ phone, name, total, orderId });
      }

      logger.info({ orderId, total, items: items.length }, 'Order placed');

      return res.json({ success: true, orderId, message: 'Order placed successfully!' });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
