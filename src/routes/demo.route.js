import express from 'express';
import { z } from 'zod';
import { demoController } from '../controllers/demo.controller.js';
import { catchAsync } from '../utils/catch-async.js';

const router = express.Router();

const validate = schema => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    next(error);
  }
};

const demoRegistrationSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  audience: z.enum(['event', 'influencer', 'group']),
  audienceType: z.string().optional(),
  primaryCategory: z.string().min(1),
  scaleMetric: z.string().min(1),
  currentPlatform: z.string().optional(),
  goals: z.string().optional(),
});

// Public — fetch next upcoming demo session
router.get('/upcoming', catchAsync(demoController.getUpcoming));

// Public — user registers for a specific demo session
router.post(
  '/:sessionId/register',
  validate(demoRegistrationSchema),
  catchAsync(demoController.register)
);

export default router;
