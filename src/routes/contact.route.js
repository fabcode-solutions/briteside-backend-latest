import express from 'express';
import { z } from 'zod';
import { catchAsync } from '../utils/catch-async.js';
import { contactLimiter } from '../middlewares/rateLimiter.js';
import { sendContactMessage } from '../controllers/contact.controller.js';

const router = express.Router();

const validate = schema => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    next(error);
  }
};

const contactSchema = z.object({
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  email: z.string().email('Please enter a valid email address'),
  subject: z.string().min(3).max(255),
  message: z.string().min(5).max(5000),
});

/**
 * @route POST /api/contact
 * @desc Send contact message to admin (admin@briteside.app)
 * @access Public
 */
router.post('/', contactLimiter, validate(contactSchema), catchAsync(sendContactMessage));

export default router;
