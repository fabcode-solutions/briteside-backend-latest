import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { events, eventTeamMembers } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { EventTeamService } from '../services/eventTeam.service.js';
import { EventService } from '../services/event.service.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const teamMemberAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let payload = null;
    let tokenExpired = false;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        payload = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          // Peek at the payload without verifying expiry to check if it was a team member token
          try {
            const decoded = jwt.decode(token);
            if (decoded?.teamMemberId) tokenExpired = true;
          } catch (_) {}
        }
        payload = null;
      }
    }

    // If the token was explicitly a team member token but expired, return 401 immediately
    // so the client knows to re-authenticate rather than receiving a confusing 403.
    if (tokenExpired) {
      return next(new ApiError(401, 'Team session expired. Please re-authenticate.'));
    }

    if (payload?.teamMemberId) {
      const member = await db.query.eventTeamMembers.findFirst({
        where: eq(eventTeamMembers.id, payload.teamMemberId),
        with: {
          team: true,
          role: true,
        },
      });

      if (member && (!payload.teamId || !member.team?.id || payload.teamId === member.team.id)) {
        req.teamMember = member;
        return next();
      }

      // Member not found or teamId mismatch — reject clearly.
      return next(new ApiError(401, 'Team credentials are invalid. Please re-authenticate.'));
    }

    // If the caller is a logged-in website user, resolve their team membership by userId + event.
    const requestedEventId = req.params.eventId || req.query.eventId || req.body.eventId;
    if (req.user?.id && requestedEventId) {
      const members = await db.query.eventTeamMembers.findMany({
        where: and(eq(eventTeamMembers.userId, req.user.id), eq(eventTeamMembers.isActive, true)),
        with: {
          team: true,
          role: true,
        },
      });

      const member = members.find(member => member.team?.eventId === requestedEventId);
      if (member) {
        req.teamMember = member;
      }
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

export const eventAccessMiddleware = async (req, res, next) => {
  try {
    const eventId = req.params.eventId || req.query.eventId || req.body.eventId;
    if (!eventId) return next();
    const event = await EventService.getEventById(eventId);
    req.event = event;
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireEventPermission = permissionKey => async (req, res, next) => {
  try {
    const user = req.user; // platform user (from passport)
    const teamMember = req.teamMember; // from teamMemberAuthMiddleware
    const eventId = req.params.eventId || req.query.eventId || req.body.eventId;

    // 1) Event's organizer bypass
    if (user && user.organizerId && req.event && req.event.organizerId === user.organizerId)
      return next();

    // 2) Platform admins
    if (user && user.roles && user.roles.includes('admin')) return next();

    // 3) Team member check
    if (teamMember) {
      const ok = await EventTeamService.hasPermission({
        teamMemberId: teamMember.id,
        eventId,
        permissionKey,
      });
      if (ok) return next();
    }

    return next(new ApiError(403, 'Forbidden'));
  } catch (error) {
    return next(error);
  }
};
