import express from 'express';
import { OrganizerProfileController } from '../controllers/organizerProfile.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.get('/:organizerId', OrganizerProfileController.getPublicProfile);
router.get('/:organizerId/events', OrganizerProfileController.getOrganizerEvents);
router.get('/:organizerId/reviews', OrganizerProfileController.getOrganizerReviews);

// Protected routes (require authentication and organizer ownership)
router.post('/:organizerId/members', authMiddleware, OrganizerProfileController.createMember);
router.get('/:organizerId/members', authMiddleware, OrganizerProfileController.getMembers);
router.patch(
  '/:organizerId/members/:memberId/status',
  authMiddleware,
  OrganizerProfileController.updateMemberStatus
);
router.patch(
  '/:organizerId/members/:memberId/regenerate-password',
  authMiddleware,
  OrganizerProfileController.regeneratePassword
);
router.delete(
  '/:organizerId/members/:memberId',
  authMiddleware,
  OrganizerProfileController.deleteMember
);

export default router;
