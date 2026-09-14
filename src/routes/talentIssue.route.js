import express from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  createIssue,
  getMyIssues,
  getEligibleEntities,
} from '../controllers/talentIssue.controller.js';

const router = express.Router();

const validate = schema => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    next(err);
  }
};

const createIssueSchema = z.object({
  entityType: z.enum(['session', 'priority_message']),
  entityId: z.string().uuid(),
  reason: z.enum(['no_reply', 'no_show', 'no_attend', 'other']),
  message: z.string().min(10).max(2000),
});

// ── Customer routes (auth required) ──────────────────────────────────────────
router.use(authMiddleware);

router.get('/eligible', getEligibleEntities);
router.post('/', validate(createIssueSchema), createIssue);
router.get('/mine', getMyIssues);

export default router;
