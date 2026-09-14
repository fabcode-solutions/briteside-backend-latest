import { db } from '../db/index.js';
import {
  eventTeams,
  eventTeamMembers,
  eventTeamRoles,
  events,
  userRoles,
  roles,
} from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import ApiError from '../utils/api-error.js';
import { generateMemberCode } from '../utils/code-generator.js';
import { ALL_PERMISSIONS, PERMISSIONS } from '../config/event-team-permissions.js';

// Alias pairs: treat refunds.view <-> payouts.view_refunds as equivalent
const PERMISSION_ALIASES = {
  [PERMISSIONS.PAYOUTS_VIEW_REFUNDS]: [PERMISSIONS.PAYOUTS_VIEW_REFUNDS, 'refunds.view'],
  'refunds.view': ['refunds.view', PERMISSIONS.PAYOUTS_VIEW_REFUNDS],
};

function resolvePermissionKeys(permissionKey) {
  return PERMISSION_ALIASES[permissionKey] || [permissionKey];
}

export class EventTeamService {
  static async createTeam(eventId, creatorId, teamData = {}) {
    // Note: permission checks should be done by controller/middleware
    const [team] = await db
      .insert(eventTeams)
      .values({
        eventId,
        name: teamData.name || 'Team',
        description: teamData.description || null,
        createdBy: creatorId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return team;
  }

  static async getTeamsForEvent(eventId) {
    const teams = await db.query.eventTeams.findMany({
      where: eq(eventTeams.eventId, eventId),
      with: {
        members: {
          with: {
            role: true,
            user: {
              id: true,
              firebaseUid: true,
              username: true,
              email: true,
              passwordHash: true,
              name: true,
              firstName: true,
              lastName: true,
              dob: true,
              image: true,
              bio: true,
            },
          },
        },
      },
    });

    return teams.map(team => ({
      ...team,
      members: team.members.filter(m => m.isActive === true),
    }));
  }

  static async createMember(teamId, memberData = {}) {
    if (!memberData.userId) {
      throw new ApiError(400, 'Only authenticated website users may be added as team members');
    }

    const data = {
      teamId,
      roleId: memberData.roleId || null,
      userId: memberData.userId,
      permissions: memberData.permissions || [],
      isActive: memberData.isActive !== undefined ? memberData.isActive : true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (memberData.password) {
      data.passwordHash = await bcrypt.hash(memberData.password, 10);
      data.memberCode = memberData.memberCode || generateMemberCode();
    }

    const [member] = await db.insert(eventTeamMembers).values(data).returning();
    return member;
  }

  static async authenticateMember(memberCode, memberPassword, teamId = null) {
    if (!memberCode || !memberPassword) throw new ApiError(400, 'Member credentials required');

    const member = await db.query.eventTeamMembers.findFirst({
      where: eq(eventTeamMembers.memberCode, memberCode),
      with: {
        team: true,
        role: true,
      },
    });

    if (!member || !member.isActive) throw new ApiError(401, 'Invalid member credentials');

    if (teamId && member.team?.id !== teamId) {
      throw new ApiError(403, 'Member is not part of this team');
    }

    const ok = await bcrypt.compare(memberPassword, member.passwordHash || '');
    if (!ok) throw new ApiError(401, 'Invalid member credentials');

    await db
      .update(eventTeamMembers)
      .set({ lastAuthenticatedAt: new Date() })
      .where(eq(eventTeamMembers.id, member.id));

    return {
      id: member.id,
      memberCode: member.memberCode,
      memberName: member.memberName ?? null,
      displayName: member.memberName ?? member.memberCode,
      isTeamMember: true,
      teamMemberId: member.id,
      teamId: member.team?.id ?? null,
      organizerId: null,
      userId: member.userId ?? null,
      role: member.role?.name || null,
      permissions: member.permissions || [],
      team: member.team || null,
      eventId: member.team?.eventId || null,
      totalScans: member.totalScans ?? 0,
    };
  }

  static async hasPermission({
    userId = null,
    teamMemberId = null,
    eventId = null,
    permissionKey,
  }) {
    console.log('[hasPermission] START', { userId, eventId, permissionKey });

    if (userId && eventId) {
      // ── Admin check only (not organizer bypass) ──
      try {
        const userRoleRows = await db
          .select({ name: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .where(eq(userRoles.userId, userId));
        if (userRoleRows?.some(r => r.name === 'admin')) return true;
      } catch (e) {
        console.log('[hasPermission] admin check error:', e.message);
      }

      // ── Check if user is the event organizer ──
      try {
        const ev = await db.query.events.findFirst({
          where: eq(events.id, eventId),
          with: { organizer: true },
        });
        // Organizer owner always has full access
        if (ev?.organizer?.userId === userId) return true;
      } catch (e) {
        console.log('[hasPermission] organizer check error:', e.message);
      }

      // ── Team member permission check ──
      try {
        const rows = await db
          .select({
            memberId: eventTeamMembers.id,
            isActive: eventTeamMembers.isActive,
            memberPerms: eventTeamMembers.permissions,
            teamEventId: eventTeams.eventId,
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
          );

        const candidateKeys = resolvePermissionKeys(permissionKey);

        for (const row of rows) {
          const rolePerms = row.rolePerms ?? [];
          const memberPerms = row.memberPerms ?? [];
          const effectivePerms = [...new Set([...rolePerms, ...memberPerms])];
          console.log('[hasPermission] effectivePerms for row', row.memberId, ':', effectivePerms);
          if (effectivePerms.some(p => candidateKeys.includes(p))) return true;
        }
      } catch (e) {
        console.log('[hasPermission] join query error:', e.message, e.stack);
      }
    }

    return false;
  }
  // ─── Helpers ──────────────────────────────────────────────────────────────

  static async #getTeamForEvent(teamId, eventId) {
    const team = await db.query.eventTeams.findFirst({
      where: and(eq(eventTeams.id, teamId), eq(eventTeams.eventId, eventId)),
    });
    if (!team) throw new ApiError(404, 'Team not found for this event');
    return team;
  }

  static async #getRole(roleId) {
    const role = await db.query.eventTeamRoles.findFirst({
      where: eq(eventTeamRoles.id, roleId),
    });
    if (!role) throw new ApiError(404, 'Team role not found');
    return role;
  }

  static async #getMemberForTeam(memberId, teamId) {
    const member = await db.query.eventTeamMembers.findFirst({
      where: and(eq(eventTeamMembers.id, memberId), eq(eventTeamMembers.teamId, teamId)),
    });
    if (!member) throw new ApiError(404, 'Member not found in this team');
    return member;
  }

  static #validatePermissions(permissions) {
    if (!Array.isArray(permissions)) throw new ApiError(400, 'permissions must be an array');
    const invalid = permissions.filter(p => !ALL_PERMISSIONS.includes(p));
    if (invalid.length > 0) throw new ApiError(400, `Unknown permission(s): ${invalid.join(', ')}`);
  }

  // ─── Role management (universal / platform-level, admin-managed) ────────

  static async getAllRoles() {
    return db.query.eventTeamRoles.findMany({
      orderBy: (t, { asc }) => [asc(t.name)],
    });
  }

  static async createRole(roleData = {}) {
    if (!roleData.name) throw new ApiError(400, 'Role name is required');
    const permissions = roleData.permissions ?? [];
    EventTeamService.#validatePermissions(permissions);

    const [role] = await db
      .insert(eventTeamRoles)
      .values({
        name: roleData.name,
        permissions,
        isActive: roleData.isActive !== undefined ? roleData.isActive : true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return role;
  }

  static async updateRole(roleId, updates = {}) {
    await EventTeamService.#getRole(roleId);

    const patch = { updatedAt: new Date() };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.isActive !== undefined) patch.isActive = updates.isActive;
    if (updates.permissions !== undefined) {
      EventTeamService.#validatePermissions(updates.permissions);
      patch.permissions = updates.permissions;
    }

    const [updated] = await db
      .update(eventTeamRoles)
      .set(patch)
      .where(eq(eventTeamRoles.id, roleId))
      .returning();
    return updated;
  }

  static async deleteRole(roleId) {
    await EventTeamService.#getRole(roleId);

    // Null out this role from any members that reference it
    await db
      .update(eventTeamMembers)
      .set({ roleId: null })
      .where(eq(eventTeamMembers.roleId, roleId));

    await db.delete(eventTeamRoles).where(eq(eventTeamRoles.id, roleId));
  }

  // ─── Team management ──────────────────────────────────────────────────────

  static async updateTeam(teamId, eventId, updates = {}) {
    await EventTeamService.#getTeamForEvent(teamId, eventId);

    const patch = { updatedAt: new Date() };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.isActive !== undefined) patch.isActive = updates.isActive;

    const [updated] = await db
      .update(eventTeams)
      .set(patch)
      .where(and(eq(eventTeams.id, teamId), eq(eventTeams.eventId, eventId)))
      .returning();
    return updated;
  }

  static async deleteTeam(teamId, eventId) {
    await EventTeamService.#getTeamForEvent(teamId, eventId);
    await db
      .delete(eventTeams)
      .where(and(eq(eventTeams.id, teamId), eq(eventTeams.eventId, eventId)));
  }

  // ─── Member management ────────────────────────────────────────────────────

  static async updateMember(memberId, teamId, eventId, updates = {}) {
    await EventTeamService.#getTeamForEvent(teamId, eventId);
    await EventTeamService.#getMemberForTeam(memberId, teamId);

    const patch = { updatedAt: new Date() };
    if (updates.roleId !== undefined) {
      if (updates.roleId !== null) await EventTeamService.#getRole(updates.roleId);
      patch.roleId = updates.roleId;
    }
    if (updates.permissions !== undefined) {
      EventTeamService.#validatePermissions(updates.permissions);
      patch.permissions = updates.permissions;
    }
    if (updates.isActive !== undefined) patch.isActive = updates.isActive;
    if (updates.password !== undefined) {
      patch.passwordHash = await bcrypt.hash(updates.password, 10);
    }

    const [updated] = await db
      .update(eventTeamMembers)
      .set(patch)
      .where(and(eq(eventTeamMembers.id, memberId), eq(eventTeamMembers.teamId, teamId)))
      .returning();
    return updated;
  }

  static async removeMember(memberId, teamId, eventId) {
    await EventTeamService.#getTeamForEvent(teamId, eventId);
    await EventTeamService.#getMemberForTeam(memberId, teamId);

    await db
      .delete(eventTeamMembers)
      .where(and(eq(eventTeamMembers.id, memberId), eq(eventTeamMembers.teamId, teamId)));
  }
}
