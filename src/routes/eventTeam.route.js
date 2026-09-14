import express from 'express';
import { EventTeamController } from '../controllers/eventTeam.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  eventAccessMiddleware,
  requireEventPermission,
  teamMemberAuthMiddleware,
} from '../middlewares/eventAccess.middleware.js';
import { PERMISSIONS } from '../config/event-team-permissions.js';

const router = express.Router({ mergeParams: true });

// Public: member auth for scanning apps
router.post('/:teamId/auth', EventTeamController.authenticateMember);

router.get(
  '/checkin-access',
  authMiddleware,
  eventAccessMiddleware,
  EventTeamController.getCheckinAccess
);

// ─── Protected: platform users or team members with proper permissions ─────────
router.get(
  '/',
  authMiddleware,
  eventAccessMiddleware,
  teamMemberAuthMiddleware,
  requireEventPermission(PERMISSIONS.TEAMS_VIEW),
  EventTeamController.listTeams
);
router.post(
  '/',
  authMiddleware,
  eventAccessMiddleware,
  teamMemberAuthMiddleware,
  requireEventPermission(PERMISSIONS.TEAMS_ADD),
  EventTeamController.createTeam
);
router.post(
  '/:teamId/members',
  authMiddleware,
  eventAccessMiddleware,
  teamMemberAuthMiddleware,
  requireEventPermission(PERMISSIONS.TEAMS_ADD),
  EventTeamController.addMember
);

// ─── Roles (read-only — admin manages creation/updates) ───────────────────────
router.get(
  '/roles',
  authMiddleware,
  eventAccessMiddleware,
  teamMemberAuthMiddleware,
  requireEventPermission(PERMISSIONS.TEAMS_VIEW),
  EventTeamController.listRoles
);

// ─── Team update / delete ─────────────────────────────────────────────────
router.patch(
  '/:teamId',
  authMiddleware,
  eventAccessMiddleware,
  teamMemberAuthMiddleware,
  requireEventPermission(PERMISSIONS.TEAMS_ADD),
  EventTeamController.updateTeam
);
router.delete(
  '/:teamId',
  authMiddleware,
  eventAccessMiddleware,
  teamMemberAuthMiddleware,
  requireEventPermission(PERMISSIONS.TEAMS_REMOVE),
  EventTeamController.deleteTeam
);

// ─── Member update / remove ──────────────────────────────────────────────
router.patch(
  '/:teamId/members/:memberId',
  authMiddleware,
  eventAccessMiddleware,
  teamMemberAuthMiddleware,
  requireEventPermission(PERMISSIONS.TEAMS_EDIT_PERMISSIONS),
  EventTeamController.updateMember
);
router.delete(
  '/:teamId/members/:memberId',
  authMiddleware,
  eventAccessMiddleware,
  teamMemberAuthMiddleware,
  requireEventPermission(PERMISSIONS.TEAMS_REMOVE),
  EventTeamController.removeMember
);

export default router;
