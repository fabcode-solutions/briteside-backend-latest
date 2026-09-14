import { EventTeamService } from '../services/eventTeam.service.js';
import jwt from 'jsonwebtoken';
import ApiError from '../utils/api-error.js';
import { EventService } from '../services/event.service.js';
import { db } from '../db/index.js';
import { eventTeamMembers, eventTeams, eventTeamRoles } from '../db/schema/index.js';
import { eq, and, is } from 'drizzle-orm';
import { PERMISSIONS } from '../config/event-team-permissions.js';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
export class EventTeamController {
  static async listTeams(req, res, next) {
    try {
      const teams = await EventTeamService.getTeamsForEvent(req.params.eventId);
      res.status(200).json({ success: true, data: teams });
    } catch (error) {
      next(error);
    }
  }

  static async createTeam(req, res, next) {
    try {
      const team = await EventTeamService.createTeam(req.params.eventId, req.user?.id, req.body);
      res.status(201).json({ success: true, data: team });
    } catch (error) {
      next(error);
    }
  }

  static async updateTeam(req, res, next) {
    try {
      const team = await EventTeamService.updateTeam(
        req.params.teamId,
        req.params.eventId,
        req.body
      );
      res.status(200).json({ success: true, data: team });
    } catch (error) {
      next(error);
    }
  }

  static async deleteTeam(req, res, next) {
    try {
      await EventTeamService.deleteTeam(req.params.teamId, req.params.eventId);
      res.status(200).json({ success: true, message: 'Team deleted' });
    } catch (error) {
      next(error);
    }
  }

  static async addMember(req, res, next) {
    try {
      const authUserId = req.user?.id;
      if (!authUserId) {
        throw new ApiError(401, 'Authenticated user required to add a team member');
      }

      const member = await EventTeamService.createMember(req.params.teamId, {
        ...req.body,
        userId: req.body.userId,
      });
      res.status(201).json({ success: true, data: member });
    } catch (error) {
      next(error);
    }
  }

  static async updateMember(req, res, next) {
    try {
      const currentTeamMemberId = req.teamMember?.id;
      const targetMemberId = req.params.memberId;
      const isEditingOwnPermissions =
        currentTeamMemberId &&
        currentTeamMemberId === targetMemberId &&
        (req.body.roleId !== undefined ||
          req.body.permissions !== undefined ||
          req.body.isActive !== undefined);

      if (isEditingOwnPermissions) {
        throw new ApiError(
          403,
          'You are not allowed to change your own team role, permissions, or active status'
        );
      }

      const member = await EventTeamService.updateMember(
        targetMemberId,
        req.params.teamId,
        req.params.eventId,
        req.body
      );
      res.status(200).json({ success: true, data: member });
    } catch (error) {
      next(error);
    }
  }

  static async removeMember(req, res, next) {
    try {
      const currentTeamMemberId = req.teamMember?.id;
      const targetMemberId = req.params.memberId;

      // Prevent self-removal
      if (currentTeamMemberId && currentTeamMemberId === targetMemberId) {
        throw new ApiError(403, 'You are not allowed to remove yourself from the team');
      }

      // ✅ Check permission
      const canRemove = await EventTeamService.hasPermission({
        userId: req.user?.id,
        eventId: req.params.eventId,
        permissionKey: PERMISSIONS.MANAGE_TEAM_MEMBERS, // or whatever key covers removal
      });

      if (!canRemove) {
        throw new ApiError(403, 'You do not have permission to remove team members');
      }

      await EventTeamService.removeMember(targetMemberId, req.params.teamId, req.params.eventId);
      res.status(200).json({ success: true, message: 'Member removed' });
    } catch (error) {
      next(error);
    }
  }

  static async authenticateMember(req, res, next) {
    try {
      const { memberCode, memberPassword } = req.body;
      const { teamId } = req.params;
      const member = await EventTeamService.authenticateMember(memberCode, memberPassword, teamId);
      // sign a short-lived token for member usage
      const token = jwt.sign({ teamMemberId: member.id, teamId: member.team?.id }, JWT_SECRET, {
        expiresIn: '6h',
      });
      res.status(200).json({ success: true, data: { member, token } });
    } catch (error) {
      next(error instanceof ApiError ? error : new ApiError(401, 'Invalid credentials'));
    }
  }

  // ─── Role management ──────────────────────────────────────────────────────

  static async listRoles(req, res, next) {
    try {
      const roles = await EventTeamService.getAllRoles();
      res.status(200).json({ success: true, data: roles });
    } catch (error) {
      next(error);
    }
  }

  static async getCheckinAccess(req, res, next) {
    try {
      const userId = req.user?.id;
      const eventId = req.params.eventId;
      if (!userId) throw new ApiError(401, 'Authentication required');

      const allowed = await EventTeamService.hasPermission({
        userId,
        eventId,
        permissionKey: PERMISSIONS.EVENT_CHECKIN_ATTENDEES,
      });

      if (!allowed) {
        throw new ApiError(403, 'You do not have check-in access for this event.');
      }

      // Check if user is the event organizer
      let organizerId = null;
      let isEventOrganizer = false;
      try {
        const event = await EventService.getEventById(eventId);
        organizerId = event?.organizerId ?? null;
        isEventOrganizer = event?.organizer?.userId === userId;
      } catch {}

      // Get team membership if exists
      const rows = await db
        .select({
          id: eventTeamMembers.id,
          teamId: eventTeamMembers.teamId,
          permissions: eventTeamMembers.permissions,
          rolePerms: eventTeamRoles.permissions,
        })
        .from(eventTeamMembers)
        .innerJoin(eventTeams, eq(eventTeamMembers.teamId, eventTeams.id))
        .leftJoin(eventTeamRoles, eq(eventTeamMembers.roleId, eventTeamRoles.id))
        .where(
          and(
            eq(eventTeamMembers.userId, userId),
            eq(eventTeamMembers.isActive, true),
            eq(eventTeams.eventId, eventId)
          )
        )
        .limit(1);

      const membership = rows[0] ?? null;

      // Get organizer member code if applicable
      let organizerMemberCode = null;
      try {
        const orgMember = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.userId, userId),
            eq(organizerMembers.organizerId, organizerId),
            eq(organizerMembers.isActive, true)
          ),
          columns: { memberCode: true },
        });
        organizerMemberCode = orgMember?.memberCode ?? null;
      } catch {}

      const effectivePermissions = membership
        ? [...new Set([...(membership.rolePerms ?? []), ...(membership.permissions ?? [])])]
        : [];

      const displayName =
        req.user.name ||
        `${req.user.firstName ?? ''} ${req.user.lastName ?? ''}`.trim() ||
        req.user.email ||
        req.user.username ||
        'Team Member';

      res.status(200).json({
        success: true,
        data: {
          allowed: true,
          context: {
            userId,
            displayName,
            isTeamMember: !!membership && !isEventOrganizer,
            isEventOrganizer,
            teamId: membership?.teamId ?? null,
            teamMemberId: membership?.id ?? null,
            organizerId,
            organizerMemberCode,
            permissions: isEventOrganizer ? [] : effectivePermissions,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
