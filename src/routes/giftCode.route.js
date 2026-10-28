import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  validateGiftCode,
  getMyGiftCodes,
  prepareGiftPurchase,
  createGiftNativeIntent,
  finalizeGiftNativePayment,
} from '../controllers/giftCode.controller.js';

const router = express.Router();

// Public — no auth needed to validate a code (user may not be logged in yet)
router.post('/validate', validateGiftCode);

// Protected
router.get('/my-gifts', authMiddleware, getMyGiftCodes);

// Gift purchase (native checkout) — mirrors /talent/sessions/checkout/prepare's
// three-step shape, but with no date/time/slot involved.
router.post('/purchase/prepare', authMiddleware, prepareGiftPurchase);
router.post('/:giftCodeId/native-intent', authMiddleware, createGiftNativeIntent);
router.post('/:giftCodeId/native-finalize', authMiddleware, finalizeGiftNativePayment);

export default router;
