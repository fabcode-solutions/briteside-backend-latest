import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { inviteLimiter } from '../middlewares/rateLimiter.js';
import { sendInvite } from '../controllers/invite.controller.js';

const router = express.Router();

/**
 * @route POST /api/invite/send-invite
 * @desc Email one or more friends an invite link to join Briteside
 * @access Private
 */
router.post('/send-invite', authMiddleware, inviteLimiter, sendInvite);

export default router;
