import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { validateGiftCode, getMyGiftCodes } from '../controllers/giftCode.controller.js';

const router = express.Router();

// Public — no auth needed to validate a code (user may not be logged in yet)
router.post('/validate', validateGiftCode);

// Protected
router.get('/my-gifts', authMiddleware, getMyGiftCodes);

export default router;
