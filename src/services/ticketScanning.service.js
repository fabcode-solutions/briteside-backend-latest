import { db } from '../db/index.js';
import {
  purchasedTickets,
  guestPurchasedTickets,
  guestOrders,
  users,
  events,
  organizers,
  organizerMembers,
  ticketScans,
  scanSessions,
  eventAttendees,
  eventTeamMembers,
  eventTickets,
  eventSchedules,
} from '../db/schema/index.js';
import { eq, and, desc, count, sql, or, ilike, inArray, ne } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import ApiError from '../utils/api-error.js';
import { EventService } from './event.service.js';

export class TicketScanningService {
  /**
   * Authenticate organizer member for scanning
   */
  static async authenticateMember(memberCode, memberPassword) {
    try {
      const member = await db.query.organizerMembers.findFirst({
        where: and(
          eq(organizerMembers.memberCode, memberCode),
          eq(organizerMembers.isActive, true)
        ),
        with: {
          organizer: {
            columns: {
              id: true,
              organizerCode: true,
              organizationName: true,
            },
          },
        },
      });
      if (member) {
        const isPasswordValid = await bcrypt.compare(memberPassword, member.memberPassword);
        if (!isPasswordValid) {
          throw new ApiError(401, 'Invalid member credentials');
        }

        // Update last login
        await db
          .update(organizerMembers)
          .set({ lastLoginAt: new Date() })
          .where(eq(organizerMembers.id, member.id));

        return {
          id: member.id,
          memberCode: member.memberCode,
          memberName: member.memberName,
          role: member.role,
          permissions: member.permissions,
          organizer: member.organizer,
          isTeamMember: false,
        };
      }

      // Fallback: try event team members (event-scoped)
      const teamMember = await db.query.eventTeamMembers.findFirst({
        where: and(
          eq(eventTeamMembers.memberCode, memberCode),
          eq(eventTeamMembers.isActive, true)
        ),
        with: {
          team: true,
          role: true,
        },
      });

      if (!teamMember) {
        throw new ApiError(401, 'Invalid member credentials');
      }

      const isTeamPasswordValid = await bcrypt.compare(
        memberPassword,
        teamMember.passwordHash || ''
      );
      if (!isTeamPasswordValid) {
        throw new ApiError(401, 'Invalid member credentials');
      }

      // Update last authenticated timestamp
      await db
        .update(eventTeamMembers)
        .set({ lastAuthenticatedAt: new Date() })
        .where(eq(eventTeamMembers.id, teamMember.id));

      // Resolve organizer via event
      let organizer = null;
      try {
        const event = await EventService.getEventById(teamMember.team.eventId);
        organizer = event?.organizer ? { id: event.organizerId } : null;
      } catch (e) {
        organizer = null;
      }

      return {
        id: teamMember.id,
        memberCode: teamMember.memberCode,
        memberName: teamMember.memberName || null,
        role: teamMember.role,
        permissions: teamMember.permissions || (teamMember.role ? teamMember.role.permissions : []),
        organizer,
        isTeamMember: true,
        team: teamMember.team,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Authenticate member error:', error);
      throw new ApiError(500, 'Failed to authenticate member');
    }
  }

  /**
   * Resolve the calling member from scan-style credentials.
   * Returns { member, isTeamMember }. Throws ApiError if none resolve.
   */
  static async resolveScanMember({ memberCode, teamMemberId, organizerId }) {
    if (!memberCode && !teamMemberId && !organizerId) {
      throw new ApiError(400, 'memberCode, teamMemberId, or organizerId is required');
    }

    if (teamMemberId) {
      const teamMember = await db.query.eventTeamMembers.findFirst({
        where: and(eq(eventTeamMembers.id, teamMemberId), eq(eventTeamMembers.isActive, true)),
        with: { team: true, role: true },
      });
      if (!teamMember) throw new ApiError(403, 'Team member not found or inactive');
      return {
        member: {
          id: teamMember.id,
          memberCode: teamMember.memberCode,
          memberName: teamMember.memberName ?? null,
          role: teamMember.role,
          permissions: teamMember.permissions,
          team: teamMember.team,
        },
        isTeamMember: true,
      };
    }

    if (organizerId) {
      return {
        member: {
          id: organizerId,
          memberCode: null,
          memberName: 'Organizer',
          organizer: { id: organizerId, organizerCode: '' },
          organizerId,
        },
        isTeamMember: false,
      };
    }

    const orgMember = await db.query.organizerMembers.findFirst({
      where: and(eq(organizerMembers.memberCode, memberCode), eq(organizerMembers.isActive, true)),
      with: { organizer: true },
    });
    if (orgMember) {
      return { member: orgMember, isTeamMember: false };
    }

    const teamMember = await db.query.eventTeamMembers.findFirst({
      where: and(eq(eventTeamMembers.memberCode, memberCode), eq(eventTeamMembers.isActive, true)),
      with: { team: true, role: true },
    });
    if (!teamMember) throw new ApiError(401, 'Invalid or inactive member');
    return {
      member: {
        id: teamMember.id,
        memberCode: teamMember.memberCode,
        memberName: teamMember.memberName ?? null,
        role: teamMember.role,
        permissions: teamMember.permissions,
        team: teamMember.team,
      },
      isTeamMember: true,
    };
  }

  /**
   * Load the event and assert the caller is scoped to it.
   * Returns the event row. Throws 404 if missing, 403 if out of scope.
   */
  static async assertEventScope(member, isTeamMember, eventId) {
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, organizerId: true, eventStatus: true, checkInCount: true , startDate: true },
    });
    if (!event) throw new ApiError(404, 'Event not found');

    if (isTeamMember) {
      if (!member.team || member.team.eventId !== eventId) {
        throw new ApiError(403, 'Not authorized for this event');
      }
    } else if (member.organizerId !== event.organizerId) {
      throw new ApiError(403, 'Not authorized for this event');
    }

    return event;
  }

  /**
   * Search event tickets by holder name/email/phone, grouped by holder identity.
   */
  static async searchAttendees({ eventId, query, memberCode, teamMemberId, organizerId }) {
    if (!eventId) throw new ApiError(400, 'eventId is required');
    if (!query || query.trim().length < 2) {
      throw new ApiError(400, 'query must be at least 2 characters');
    }

    const { member, isTeamMember } = await this.resolveScanMember({
      memberCode,
      teamMemberId,
      organizerId,
    });
    await this.assertEventScope(member, isTeamMember, eventId);

    const q = `%${query.trim()}%`;

    // Resolve which buyers match (by ticket holder OR user account fields)
    const matched = await db
      .select({ userId: purchasedTickets.userId })
      .from(purchasedTickets)
      .leftJoin(users, eq(purchasedTickets.userId, users.id))
      .where(
        and(
          eq(purchasedTickets.eventId, eventId),
          or(
            ilike(purchasedTickets.holderName, q),
            ilike(users.name, q),
            ilike(users.firstName, q),
            ilike(users.lastName, q),
            ilike(users.email, q),
            ilike(users.phoneNumber, q)
          )
        )
      );

    const userIds = [...new Set(matched.map(m => m.userId))];

    // Registered: every non-refunded ticket those buyers own for the event
    let regTickets = [];
    if (userIds.length) {
      regTickets = await db
        .select({
          id: purchasedTickets.id,
          ticketCode: purchasedTickets.ticketCode,
          attendeeName: purchasedTickets.holderName,
          buyerName: users.name,
          buyerEmail: users.email,
          buyerPhone: users.phoneNumber,
          tierName: eventTickets.name,
          price: purchasedTickets.price,
          isUsed: purchasedTickets.isUsed,
          usedAt: purchasedTickets.usedAt,
          scheduleTitle: eventSchedules.title,
          scheduleDate: eventSchedules.date,
          scheduleStartTime: eventSchedules.startTime,
          scheduleEndTime: eventSchedules.endTime,
        })
        .from(purchasedTickets)
        .leftJoin(users, eq(purchasedTickets.userId, users.id))
        .leftJoin(eventTickets, eq(purchasedTickets.ticketTierId, eventTickets.id))
        .leftJoin(eventSchedules, eq(purchasedTickets.eventScheduleId, eventSchedules.id))
        .where(
          and(
            eq(purchasedTickets.eventId, eventId),
            inArray(purchasedTickets.userId, userIds),
            ne(purchasedTickets.status, 'refunded')
          )
        );
    }

    // Guests (no account): match by ticket holder OR guest-order buyer fields
    const guestMatched = await db
      .select({ guestOrderId: guestPurchasedTickets.guestOrderId })
      .from(guestPurchasedTickets)
      .leftJoin(guestOrders, eq(guestPurchasedTickets.guestOrderId, guestOrders.id))
      .where(
        and(
          eq(guestPurchasedTickets.eventId, eventId),
          or(
            ilike(guestPurchasedTickets.holderName, q),
            ilike(guestPurchasedTickets.holderEmail, q),
            ilike(guestPurchasedTickets.holderPhone, q),
            ilike(guestOrders.guestName, q),
            ilike(guestOrders.guestEmail, q),
            ilike(guestOrders.guestPhone, q)
          )
        )
      );

    const guestOrderIds = [...new Set(guestMatched.map(m => m.guestOrderId))];

    let guestTickets = [];
    if (guestOrderIds.length) {
      guestTickets = await db
        .select({
          id: guestPurchasedTickets.id,
          ticketCode: guestPurchasedTickets.ticketCode,
          attendeeName: guestPurchasedTickets.holderName,
          buyerName: guestOrders.guestName,
          buyerEmail: guestOrders.guestEmail,
          buyerPhone: guestOrders.guestPhone,
          tierName: eventTickets.name,
          price: guestPurchasedTickets.price,
          isUsed: guestPurchasedTickets.isUsed,
          usedAt: guestPurchasedTickets.usedAt,
        })
        .from(guestPurchasedTickets)
        .leftJoin(guestOrders, eq(guestPurchasedTickets.guestOrderId, guestOrders.id))
        .leftJoin(eventTickets, eq(guestPurchasedTickets.ticketTierId, eventTickets.id))
        .where(
          and(
            eq(guestPurchasedTickets.eventId, eventId),
            inArray(guestPurchasedTickets.guestOrderId, guestOrderIds),
            ne(guestPurchasedTickets.status, 'refunded')
          )
        );
    }

    const tickets = [
      ...regTickets.map(t => ({ ...t, source: 'registered' })),
      ...guestTickets.map(t => ({
        ...t,
        source: 'guest',
        scheduleTitle: null,
        scheduleDate: null,
        scheduleStartTime: null,
        scheduleEndTime: null,
      })),
    ];

    return { tickets };
  }

  /**
   * Manually check in specific tickets by id. Skips (does not fail) tickets
   * that are wrong-event / inactive / already-used. No time-window check.
   */
  static async manualCheckIn({
    eventId,
    ticketIds = [],
    guestTicketIds = [],
    memberCode,
    teamMemberId,
    organizerId,
    deviceInfo = {},
  }) {
    if (!eventId) throw new ApiError(400, 'eventId is required');
    if ((!ticketIds || !ticketIds.length) && (!guestTicketIds || !guestTicketIds.length)) {
      throw new ApiError(400, 'At least one ticketId or guestTicketId is required');
    }

    const { member, isTeamMember } = await this.resolveScanMember({
      memberCode,
      teamMemberId,
      organizerId,
    });
   const event = await this.assertEventScope(member, isTeamMember, eventId);

    if (event.eventStatus !== 'published') throw new ApiError(400, 'Event is not active');

    const checkedIn = [];
    const skipped = [];
    const now = new Date();

    const eventStart = new Date(event.startDate);
    const scanWindow = new Date(eventStart.getTime() - 3 * 60 * 60 * 1000);

    if (now < scanWindow) {
      throw new ApiError(
        400,
        `Check-in has not started yet. Check-in opens at ${scanWindow.toLocaleString()}`
      );
    }

    const organizerCode = isTeamMember ? event.organizerId : member.organizer?.organizerCode || '';

    const buildScanInsert = (ticketRow, isGuest) => {
      const insert = {
        ticketId: isGuest ? null : ticketRow.id,
        eventId,
        organizerId: event.organizerId,
        ticketCode: ticketRow.ticketCode,
        eventCode: '',
        organizerCode,
        scanType: 'entry',
        scanLocation: 'manual',
        isValid: true,
        deviceInfo: deviceInfo || {},
        scanData: 'manual',
        scannedAt: now,
      };
      if (isTeamMember) insert.scannedByTeamMember = member.id;
      else if (member.id !== member.organizerId) insert.scannedBy = member.id;
      return insert;
    };

    // ── Registered tickets ────────────────────────────────────────────
    const regTickets = ticketIds.length
      ? await db.query.purchasedTickets.findMany({ where: inArray(purchasedTickets.id, ticketIds) })
      : [];
    const regById = new Map(regTickets.map(t => [t.id, t]));

    for (const id of ticketIds) {
      const t = regById.get(id);
      if (!t || t.eventId !== eventId) {
        skipped.push({ id, reason: 'wrong_event' });
        continue;
      }
      if (t.status !== 'active') {
        skipped.push({ id, reason: 'inactive' });
        continue;
      }
      if (t.isUsed) {
        skipped.push({ id, reason: 'already_used' });
        continue;
      }

      await db
        .update(purchasedTickets)
        .set({
          isUsed: true,
          usedAt: now,
          lastScannedAt: now,
          scanCount: (t.scanCount || 0) + 1,
          ...(t.firstScannedAt ? {} : { firstScannedAt: now }),
          ...(isTeamMember || member.id === member.organizerId ? {} : { usedBy: member.id }),
        })
        .where(eq(purchasedTickets.id, t.id));

      await this.recordScan(buildScanInsert(t, false));

      try {
        const existing = await db.query.eventAttendees.findFirst({
          where: and(eq(eventAttendees.eventId, eventId), eq(eventAttendees.userId, t.userId)),
        });
        const attendeeData = {
          status: 'checked_in',
          checkInMethod: 'manual',
          checkedInByMember: isTeamMember || member.id === member.organizerId ? null : member.id,
          checkedInByTeamMember: isTeamMember ? member.id : null,
          checkInDeviceInfo: deviceInfo || {},
          checkedInAt: now,
        };
        if (existing) {
          await db
            .update(eventAttendees)
            .set(attendeeData)
            .where(eq(eventAttendees.id, existing.id));
        } else {
          await db.insert(eventAttendees).values({
            eventId,
            userId: t.userId,
            ticketTierId: t.ticketTierId,
            createdAt: now,
            ...attendeeData,
          });
        }
      } catch (err) {
        console.error('Manual check-in attendee upsert failed', err);
      }

      checkedIn.push(id);
    }

    // ── Guest tickets ─────────────────────────────────────────────────
    const guestTickets = guestTicketIds.length
      ? await db.query.guestPurchasedTickets.findMany({
          where: inArray(guestPurchasedTickets.id, guestTicketIds),
        })
      : [];
    const guestById = new Map(guestTickets.map(t => [t.id, t]));

    for (const id of guestTicketIds) {
      const t = guestById.get(id);
      if (!t || t.eventId !== eventId) {
        skipped.push({ id, reason: 'wrong_event' });
        continue;
      }
      if (t.status !== 'active') {
        skipped.push({ id, reason: 'inactive' });
        continue;
      }
      if (t.isUsed) {
        skipped.push({ id, reason: 'already_used' });
        continue;
      }

      await db
        .update(guestPurchasedTickets)
        .set({ isUsed: true, usedAt: now, scanCount: (t.scanCount || 0) + 1, updatedAt: now })
        .where(eq(guestPurchasedTickets.id, t.id));

      await this.recordScan(buildScanInsert(t, true));

      checkedIn.push(id);
    }

    // ── Event check-in count ──────────────────────────────────────────
    const checkInCount = (event.checkInCount || 0) + checkedIn.length;
    if (checkedIn.length > 0) {
      await db.update(events).set({ checkInCount }).where(eq(events.id, eventId));
    }

    return { checkedIn, skipped, checkInCount };
  }

  /**
   * Start a scan session and persist it
   */
  static async startSession({
    memberCode,
    memberPassword,
    eventId = null,
    deviceInfo = {},
    ipAddress = null,
    userAgent = null,
  }) {
    try {
      // Authenticate member with credentials
      const member = await this.authenticateMember(memberCode, memberPassword);

      const values = {
        organizerId: member.organizer?.id,
        eventId,
        deviceInfo: deviceInfo || {},
        ipAddress,
        userAgent,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (member.isTeamMember) {
        values.teamMemberId = member.id;
      } else {
        values.memberId = member.id;
      }

      const [session] = await db.insert(scanSessions).values(values).returning();

      return session;
    } catch (error) {
      console.error('Start session error:', error);
      throw new ApiError(500, 'Failed to start session');
    }
  }

  /**
   * End an existing scan session
   */
  static async endSession(sessionId) {
    try {
      if (!sessionId) throw new ApiError(400, 'Session ID is required');

      const [session] = await db
        .update(scanSessions)
        .set({ endedAt: new Date(), status: 'ended', updatedAt: new Date() })
        .where(eq(scanSessions.id, sessionId))
        .returning();

      if (!session) throw new ApiError(404, 'Session not found');

      return session;
    } catch (error) {
      console.error('End session error:', error);
      throw new ApiError(500, 'Failed to end session');
    }
  }

  /**
   * Scan and verify ticket with comprehensive validation
   */
  static async scanTicket(scanData) {
    const scanStartTime = Date.now();

    try {
      const {
        qrCodeData,
        memberCode,
        teamMemberId: directTeamMemberId,
        organizerId: directOrganizerId,
        scanLocation,
        scanType = 'entry',
        deviceInfo = {},
        geoLocation = {},
        ipAddress,
        userAgent,
        sessionId,
      } = scanData;

      if (!qrCodeData || (!memberCode && !directTeamMemberId && !directOrganizerId)) {
        throw new ApiError(
          400,
          'QR code data and member code, teamMemberId, or organizerId are required'
        );
      }

      let member;
      let isTeamMember = false;

      if (directTeamMemberId) {
        const teamMember = await db.query.eventTeamMembers.findFirst({
          where: and(
            eq(eventTeamMembers.id, directTeamMemberId),
            eq(eventTeamMembers.isActive, true)
          ),
          with: { team: true, role: true },
        });

        if (!teamMember) {
          throw new ApiError(403, 'Team member not found or inactive');
        }

        member = {
          id: teamMember.id,
          memberCode: teamMember.memberCode,
          memberName: teamMember.memberName ?? null,
          role: teamMember.role,
          permissions: teamMember.permissions,
          team: teamMember.team,
          isTeamMember: true,
        };
        isTeamMember = true;
      } else if (directOrganizerId) {
        member = {
          id: directOrganizerId,
          memberCode: null,
          memberName: 'Organizer',
          role: null,
          permissions: [],
          organizer: { id: directOrganizerId, organizerCode: '' },
          organizerId: directOrganizerId,
          isTeamMember: false,
        };
        isTeamMember = false;
      } else {
        member = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.memberCode, memberCode),
            eq(organizerMembers.isActive, true)
          ),
          with: { organizer: true },
        });

        if (!member) {
          const teamMember = await db.query.eventTeamMembers.findFirst({
            where: and(
              eq(eventTeamMembers.memberCode, memberCode),
              eq(eventTeamMembers.isActive, true)
            ),
            with: { team: true, role: true },
          });

          if (!teamMember) {
            await this.recordFailedScan({
              qrCodeData,
              memberCode,
              errorMessage: 'Invalid or inactive member',
              scanLocation,
              ipAddress,
              userAgent,
              sessionId: sessionId || null,
              deviceInfo: deviceInfo || {},
            });
            throw new ApiError(401, 'Invalid or inactive member');
          }

          member = {
            id: teamMember.id,
            memberCode: teamMember.memberCode,
            memberName: teamMember.memberName ?? null,
            role: teamMember.role,
            permissions: teamMember.permissions,
            team: teamMember.team,
            isTeamMember: true,
          };
          isTeamMember = true;
        }
      }

      let qrData;
      const qrCodeHash = crypto.createHash('sha256').update(qrCodeData).digest('hex');

      try {
        qrData = JSON.parse(qrCodeData);
      } catch (error) {
        const plainTicket = await db.query.purchasedTickets.findFirst({
          where: eq(purchasedTickets.ticketCode, qrCodeData),
          with: {
            event: {
              columns: {
                id: true,
                title: true,
                startDate: true,
                endDate: true,
                eventStatus: true,
                organizerId: true,
              },
            },
            organizer: {
              columns: {
                id: true,
                organizationName: true,
                organizerCode: true,
              },
            },
          },
        });

        if (!plainTicket) {
          throw new ApiError(404, 'Ticket not found');
        }

        qrData = {
          eventId: plainTicket.eventId,
          organizerId: plainTicket.organizerId,
          ticketCode: plainTicket.ticketCode,
          ticketTierId: plainTicket.ticketTierId,
          holderName: plainTicket.holderName,
          price: plainTicket.price,
          eventStartDate: plainTicket.event.startDate,
        };
      }

      const {
        eventId,
        organizerId,
        ticketCode,
        ticketTierId,
        holderName,
        price,
        eventStartDate,
        isUsed: qrIsUsed,
        usedAt: qrUsedAt,
      } = qrData;

      if (!eventId || !organizerId || !ticketCode || !ticketTierId) {
        await this.recordFailedScan({
          qrCodeData,
          memberCode,
          memberId: member.id,
          organizerId: member.organizerId,
          errorMessage: 'Incomplete QR code data',
          scanLocation,
          ipAddress,
          userAgent,
          sessionId: sessionId || null,
          deviceInfo: deviceInfo || {},
        });
        throw new ApiError(400, 'Incomplete QR code data');
      }

      if (member.isTeamMember) {
        if (!member.team || member.team.eventId !== eventId) {
          await this.recordFailedScan({
            qrCodeData,
            memberCode,
            memberId: member.id,
            organizerId: organizerId,
            eventId,
            ticketCode,
            errorMessage: 'Team member not authorized for this event',
            scanLocation,
            ipAddress,
            userAgent,
          });
          throw new ApiError(403, 'Team member not authorized for this event');
        }
      } else {
        if (member.organizerId !== organizerId) {
          await this.recordFailedScan({
            qrCodeData,
            memberCode,
            memberId: member.id,
            organizerId: member.organizerId,
            eventId,
            ticketCode,
            errorMessage: 'Member not authorized for this organizer',
            scanLocation,
            ipAddress,
            userAgent,
          });
          throw new ApiError(403, 'Member not authorized for this organizer');
        }
      }

      const ticket = await db.query.purchasedTickets.findFirst({
        where: and(
          eq(purchasedTickets.ticketCode, ticketCode),
          eq(purchasedTickets.eventId, eventId),
          eq(purchasedTickets.organizerId, organizerId),
          eq(purchasedTickets.ticketTierId, ticketTierId)
        ),
        with: {
          event: {
            columns: {
              id: true,
              title: true,
              startDate: true,
              endDate: true,
              eventStatus: true,
            },
          },
          organizer: {
            columns: {
              id: true,
              organizationName: true,
            },
          },
        },
      });

      if (!ticket && qrData.isGuestTicket) {
        const guestTicket = await db.query.guestPurchasedTickets.findFirst({
          where: and(
            eq(guestPurchasedTickets.ticketCode, ticketCode),
            eq(guestPurchasedTickets.eventId, eventId),
            eq(guestPurchasedTickets.ticketTierId, ticketTierId)
          ),
        });

        if (!guestTicket) {
          throw new ApiError(404, 'Guest ticket not found or invalid');
        }

        const guestEvent = await db.query.events.findFirst({
          where: eq(events.id, eventId),
          columns: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            eventStatus: true,
            organizerId: true,
          },
        });

        if (!guestEvent) throw new ApiError(404, 'Event not found');
        if (guestEvent.eventStatus !== 'published') throw new ApiError(400, 'Event is not active');
        if (guestTicket.status !== 'active')
          throw new ApiError(400, `Ticket is ${guestTicket.status}`);

        const now = new Date();
        const eventStart = new Date(guestEvent.startDate);
        const eventEnd = new Date(guestEvent.endDate);
        const scanWindow = new Date(eventStart.getTime() - 2 * 60 * 60 * 1000);
        if (now < scanWindow) throw new ApiError(400, 'Event check-in has not started yet');
        if (now > eventEnd) throw new ApiError(400, 'Event has already ended');
        if (scanType === 'entry' && guestTicket.isUsed) {
          throw new ApiError(400, `Guest ticket already used at ${guestTicket.usedAt}`);
        }

        const guestScannedAt = new Date();
        const guestUpdateData = {
          scanCount: (guestTicket.scanCount || 0) + 1,
          updatedAt: guestScannedAt,
        };
        if (!guestTicket.isUsed) {
          guestUpdateData.isUsed = true;
          guestUpdateData.usedAt = guestScannedAt;
        }
        await db
          .update(guestPurchasedTickets)
          .set(guestUpdateData)
          .where(eq(guestPurchasedTickets.id, guestTicket.id));

        const guestScanInsert = {
          ticketId: null,
          eventId,
          organizerId,
          ticketCode,
          eventCode: '',
          organizerCode: isTeamMember ? organizerId : member.organizer?.organizerCode || '',
          scanType,
          scanLocation,
          isValid: true,
          sessionId: sessionId || null,
          deviceInfo: deviceInfo || {},
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
          scanData: qrCodeData,
          scannedAt: guestScannedAt,
        };
        if (isTeamMember) {
          guestScanInsert.scannedByTeamMember = member.id;
        } else {
          guestScanInsert.scannedBy = member.id;
        }
        await this.recordScan(guestScanInsert);

        if (isTeamMember) {
          await db
            .update(eventTeamMembers)
            .set({ lastAuthenticatedAt: guestScannedAt })
            .where(eq(eventTeamMembers.id, member.id));
        } else if (member.id !== member.organizerId) {
          await db
            .update(organizerMembers)
            .set({ totalScans: (member.totalScans || 0) + 1, lastScanAt: guestScannedAt })
            .where(eq(organizerMembers.id, member.id));
        }

        return {
          success: true,
          isGuestTicket: true,
          ticket: {
            id: guestTicket.id,
            ticketCode: guestTicket.ticketCode,
            holderName: guestTicket.holderName,
            holderEmail: guestTicket.holderEmail,
            price: guestTicket.price,
            scanCount: (guestTicket.scanCount || 0) + 1,
          },
          event: {
            id: guestEvent.id,
            title: guestEvent.title,
            startDate: guestEvent.startDate,
            endDate: guestEvent.endDate,
          },
          organizer: { id: organizerId },
          scannedAt: guestScannedAt,
          scannedBy: {
            id: member.id,
            memberName: member.memberName,
            memberCode: member.memberCode,
          },
        };
      }

      if (!ticket) throw new ApiError(404, 'Ticket not found or invalid');

      console.log('MISMATCH DEBUG', {
        dbName: ticket.holderName,
        qrName: holderName,
        nameMatch: ticket.holderName?.trim() === holderName?.trim(),

        dbPrice: ticket.price,
        qrPrice: price,
        dbPriceType: typeof ticket.price,
        qrPriceType: typeof price,
        priceMatch: parseFloat(ticket.price) === parseFloat(price),

        dbDate: new Date(ticket.event.startDate).getTime(),
        qrDate: new Date(eventStartDate).getTime(),
        dateMatch:
          Math.floor(new Date(ticket.event.startDate).getTime() / 1000) ===
          Math.floor(new Date(eventStartDate).getTime() / 1000),
      });

      if (
        ticket.holderName?.trim() !== holderName?.trim() ||
        parseFloat(ticket.price) !== parseFloat(price)
      ) {
        throw new ApiError(400, 'Ticket verification failed - data mismatch');
      }

      if (ticket.event.eventStatus !== 'published') {
        throw new ApiError(400, 'Event is not active');
      }

      if (scanType === 'entry' && ticket.isUsed) {
        await this.recordScan({
          ticketId: ticket.id,
          eventId,
          organizerId,
          ...(isTeamMember
            ? { scannedByTeamMember: member.id }
            : member.id !== member.organizerId
              ? { scannedBy: member.id }
              : {}),
          ticketCode,
          eventCode: ticket.event.eventCode || '',
          organizerCode: isTeamMember ? organizerId : member.organizer?.organizerCode || '',
          scanType,
          scanLocation,
          isValid: false,
          sessionId: sessionId || null,
          deviceInfo: deviceInfo || {},
          scanData: `Error: Ticket already used - ${qrCodeData}`,
          scannedAt: new Date(),
        });
        throw new ApiError(409, 'Ticket already used');
      }

      if (ticket.status !== 'active') {
        throw new ApiError(400, `Ticket is ${ticket.status}`);
      }

      const now = new Date();
      const eventStart = new Date(ticket.event.startDate);
      const eventEnd = new Date(ticket.event.endDate);
      const scanWindow = new Date(eventStart.getTime() - 2 * 60 * 60 * 1000);

     if (now < scanWindow) {
        throw new ApiError(
          400,
          `Check-in has not started yet. Check-in opens at ${scanWindow.toLocaleString()}`
        );
      }
      if (now > eventEnd) {
        throw new ApiError(
          400,
          `Event has already ended. It ended at ${eventEnd.toLocaleString()}`
        );
      }

      const scannedAt = new Date();

      const updateData = {
        scanCount: ticket.scanCount + 1,
        lastScannedAt: scannedAt,
        ...(isTeamMember || member.id === member.organizerId ? {} : { usedBy: member.id }),
      };

      if (!ticket.isUsed) {
        updateData.isUsed = true;
        updateData.usedAt = scannedAt;
        updateData.firstScannedAt = scannedAt;
      }

      await db.update(purchasedTickets).set(updateData).where(eq(purchasedTickets.id, ticket.id));

      const scanInsert = {
        ticketId: ticket.id,
        eventId,
        organizerId,
        ticketCode,
        eventCode: ticket.event.eventCode || '',
        organizerCode: isTeamMember ? organizerId : member.organizer?.organizerCode || '',
        scanType,
        scanLocation,
        isValid: true,
        sessionId: sessionId || null,
        deviceInfo: deviceInfo || {},
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        scanData: qrCodeData,
        scannedAt,
      };

      if (isTeamMember) {
        scanInsert.scannedByTeamMember = member.id;
      } else if (member.id !== member.organizerId) {
        scanInsert.scannedBy = member.id;
      }

      await this.recordScan(scanInsert);

      if (isTeamMember) {
        await db
          .update(eventTeamMembers)
          .set({ lastAuthenticatedAt: new Date() })
          .where(eq(eventTeamMembers.id, member.id));
      } else if (member.id !== member.organizerId) {
        await db
          .update(organizerMembers)
          .set({ totalScans: (member.totalScans || 0) + 1, lastScanAt: new Date() })
          .where(eq(organizerMembers.id, member.id));
      }

      try {
        if (ticket.userId) {
          const existing = await db.query.eventAttendees.findFirst({
            where: and(
              eq(eventAttendees.eventId, eventId),
              eq(eventAttendees.userId, ticket.userId)
            ),
          });

          if (existing) {
            await db
              .update(eventAttendees)
              .set({
                status: 'checked_in',
                checkInMethod: 'qr_scan',
                checkedInByMember: isTeamMember ? null : member.id,
                checkedInByTeamMember: isTeamMember ? member.id : null,
                checkInDeviceInfo: deviceInfo || {},
                checkedInAt: scannedAt,
              })
              .where(eq(eventAttendees.id, existing.id));
          } else {
            await db.insert(eventAttendees).values({
              eventId,
              userId: ticket.userId,
              ticketTierId: ticket.ticketTierId,
              status: 'checked_in',
              checkInMethod: 'qr_scan',
              checkedInByMember: isTeamMember ? null : member.id,
              checkedInByTeamMember: isTeamMember ? member.id : null,
              checkInDeviceInfo: deviceInfo || {},
              checkedInAt: scannedAt,
              createdAt: new Date(),
            });
          }

          await db
            .update(events)
            .set({ checkInCount: ticket.event.checkInCount + 1 })
            .where(eq(events.id, eventId));
        }
      } catch (err) {
        console.error('Upsert attendee failed', err);
      }

      return {
        success: true,
        ticket: {
          id: ticket.id,
          ticketCode: ticket.ticketCode,
          holderName: ticket.holderName,
          holderEmail: ticket.holderEmail,
          price: ticket.price,
          scanCount: ticket.scanCount + 1,
        },
        event: {
          id: ticket.event.id,
          title: ticket.event.title,
          startDate: ticket.event.startDate,
          endDate: ticket.event.endDate,
        },
        organizer: {
          id: ticket.organizer.id,
          organizationName: ticket.organizer.organizationName,
        },
        scannedAt: new Date(),
        scannedBy: {
          id: member.id,
          memberName: member.memberName,
          memberCode: member.memberCode,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Scan ticket error FULL:', error.message, error.stack);
      throw new ApiError(500, 'Failed to scan ticket');
    }
  }

  /**
   * Record ticket scan in database
   */
  static async recordScan(scanData) {
    try {
      const [scan] = await db.insert(ticketScans).values(scanData).returning();

      return scan;
    } catch (error) {
      console.error('Record scan error:', error);
      return null;
    }
  }

  /**
   * Record failed scan attempts for security monitoring
   */
  static async recordFailedScan(failureData) {
    try {
      const insert = {
        ticketId: null,
        eventId: failureData.eventId || null,
        organizerId: failureData.organizerId || null,
        ticketCode: failureData.ticketCode || 'INVALID',
        eventCode: 'INVALID',
        organizerCode: 'INVALID',
        scanType: 'entry',
        scanLocation: failureData.scanLocation,
        isValid: false,
        sessionId: failureData.sessionId || null,
        deviceInfo: failureData.deviceInfo || {},
        scanData: `Error: ${failureData.errorMessage} - ${failureData.qrCodeData}`,
        scannedAt: new Date(),
      };

      if (failureData.teamMemberId) {
        insert.scannedByTeamMember = failureData.teamMemberId;
      } else if (failureData.isTeamMember) {
        insert.scannedByTeamMember = failureData.memberId || null;
      } else {
        insert.scannedBy = failureData.memberId || null;
      }

      await db.insert(ticketScans).values(insert);
    } catch (error) {
      console.error('Record failed scan error:', error);
    }
  }

  /**
   * Get scan history for an event
   */
  static async getScanHistory(eventId, organizerId, filters = {}) {
    try {
      const { page = 1, limit = 50, memberId, isValid } = filters;
      const offset = (page - 1) * limit;

      let conditions = [eq(ticketScans.eventId, eventId), eq(ticketScans.organizerId, organizerId)];

      if (memberId) {
        conditions.push(
          or(eq(ticketScans.scannedBy, memberId), eq(ticketScans.scannedByTeamMember, memberId))
        );
      }

      if (isValid !== undefined) {
        conditions.push(eq(ticketScans.isValid, isValid));
      }

      const [scansResult, totalCount] = await Promise.all([
        db
          .select({
            id: ticketScans.id,
            ticketCode: ticketScans.ticketCode,
            scanType: ticketScans.scanType,
            scanLocation: ticketScans.scanLocation,
            isValid: ticketScans.isValid,
            scannedAt: ticketScans.scannedAt,
            organizerMemberId: organizerMembers.id,
            organizerMemberName: organizerMembers.memberName,
            organizerMemberCode: organizerMembers.memberCode,
            teamMemberId: eventTeamMembers.id,
            teamMemberCode: eventTeamMembers.memberCode,
            holderName: purchasedTickets.holderName,
          })
          .from(ticketScans)
          .leftJoin(purchasedTickets, eq(ticketScans.ticketId, purchasedTickets.id))
          .leftJoin(organizerMembers, eq(ticketScans.scannedBy, organizerMembers.id))
          .leftJoin(eventTeamMembers, eq(ticketScans.scannedByTeamMember, eventTeamMembers.id))
          .where(and(...conditions))
          .orderBy(desc(ticketScans.scannedAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(ticketScans)
          .where(and(...conditions)),
      ]);

      // Normalize member info to match previous shape
      const scans = scansResult.map(s => {
        const member = s.organizerMemberId
          ? {
              id: s.organizerMemberId,
              memberName: s.organizerMemberName,
              memberCode: s.organizerMemberCode,
              type: 'organizer',
            }
          : s.teamMemberId
            ? {
                id: s.teamMemberId,
                memberName: null,
                memberCode: s.teamMemberCode,
                type: 'team',
              }
            : null;

        return {
          id: s.id,
          ticketCode: s.ticketCode,
          holderName: s.holderName,
          scanType: s.scanType,
          scanLocation: s.scanLocation,
          isValid: s.isValid,
          scannedAt: s.scannedAt,
          member,
        };
      });

      return {
        scans,
        pagination: {
          page,
          limit,
          total: totalCount[0].count,
          pages: Math.ceil(totalCount[0].count / limit),
        },
      };
    } catch (error) {
      console.error('Get scan history error:', error);
      throw new ApiError(500, 'Failed to get scan history');
    }
  }

  /**
   * Get member scan statistics
   */
  static async getMemberScanStats(organizerId, memberId) {
    try {
      // Try organizer member first
      let member = await db.query.organizerMembers.findFirst({
        where: and(
          eq(organizerMembers.id, memberId),
          eq(organizerMembers.organizerId, organizerId)
        ),
      });

      let isTeam = false;
      if (!member) {
        // Try event team member
        const teamMember = await db.query.eventTeamMembers.findFirst({
          where: eq(eventTeamMembers.id, memberId),
        });
        if (!teamMember) {
          throw new ApiError(404, 'Member not found');
        }
        member = teamMember;
        isTeam = true;
      }

      // Build scanStats query depending on member type
      const scanStats = await db
        .select({
          totalScans: count(),
          validScans: count(ticketScans.id).where(eq(ticketScans.isValid, true)),
          invalidScans: count(ticketScans.id).where(eq(ticketScans.isValid, false)),
        })
        .from(ticketScans)
        .where(
          isTeam
            ? eq(ticketScans.scannedByTeamMember, memberId)
            : eq(ticketScans.scannedBy, memberId)
        );

      return {
        member: {
          id: member.id,
          memberName: member.memberName,
          memberCode: member.memberCode,
          totalScans: member.totalScans,
          lastScanAt: member.lastScanAt,
        },
        stats: scanStats[0] || {
          totalScans: 0,
          validScans: 0,
          invalidScans: 0,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Get member scan stats error:', error);
      throw new ApiError(500, 'Failed to get member scan statistics');
    }
  }

  /**
   * Verify ticket without scanning (read-only)
   */
  static async verifyTicketOnly(qrCodeData) {
    try {
      let qrData;
      let ticket;

      try {
        qrData = JSON.parse(qrCodeData);
      } catch (error) {
        // Not JSON — plain ticket code, look it up directly
        ticket = await db.query.purchasedTickets.findFirst({
          where: eq(purchasedTickets.ticketCode, qrCodeData),
          with: {
            event: {
              columns: {
                id: true,
                title: true,
                startDate: true,
                endDate: true,
                eventStatus: true,
              },
            },
            organizer: {
              columns: {
                id: true,
                organizationName: true,
              },
            },
          },
        });

        if (!ticket) {
          throw new ApiError(404, 'Ticket not found or invalid');
        }

        return {
          valid: true,
          ticket: {
            id: ticket.id,
            ticketCode: ticket.ticketCode,
            holderName: ticket.holderName,
            holderEmail: ticket.holderEmail,
            price: ticket.price,
            status: ticket.status,
            isUsed: ticket.isUsed,
            scanCount: ticket.scanCount,
          },
          event: {
            id: ticket.event.id,
            title: ticket.event.title,
            startDate: ticket.event.startDate,
            endDate: ticket.event.endDate,
            eventStatus: ticket.event.eventStatus,
          },
          organizer: {
            id: ticket.organizer.id,
            organizationName: ticket.organizer.organizationName,
          },
        };
      }

      // ── JSON QR code path ─────────────────────────────────────────────────
      const { eventId, organizerId, ticketCode, ticketTierId, holderName, price, eventStartDate } =
        qrData;

      if (!eventId || !organizerId || !ticketCode || !ticketTierId) {
        throw new ApiError(400, 'Incomplete QR code data');
      }

      ticket = await db.query.purchasedTickets.findFirst({
        where: and(
          eq(purchasedTickets.ticketCode, ticketCode),
          eq(purchasedTickets.eventId, eventId),
          eq(purchasedTickets.organizerId, organizerId),
          eq(purchasedTickets.ticketTierId, ticketTierId)
        ),
        with: {
          event: {
            columns: {
              id: true,
              title: true,
              startDate: true,
              endDate: true,
              eventStatus: true,
            },
          },
          organizer: {
            columns: {
              id: true,
              organizationName: true,
            },
          },
        },
      });

      if (!ticket) {
        throw new ApiError(404, 'Ticket not found or invalid');
      }

      if (
        ticket.holderName?.trim() !== holderName?.trim() ||
        parseFloat(ticket.price) !== parseFloat(price)
      ) {
        throw new ApiError(400, 'Ticket verification failed - data mismatch');
      }

      return {
        valid: true,
        ticket: {
          id: ticket.id,
          ticketCode: ticket.ticketCode,
          holderName: ticket.holderName,
          holderEmail: ticket.holderEmail,
          price: ticket.price,
          status: ticket.status,
          isUsed: ticket.isUsed,
          scanCount: ticket.scanCount,
        },
        event: {
          id: ticket.event.id,
          title: ticket.event.title,
          startDate: ticket.event.startDate,
          endDate: ticket.event.endDate,
          eventStatus: ticket.event.eventStatus,
        },
        organizer: {
          id: ticket.organizer.id,
          organizationName: ticket.organizer.organizationName,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Verify ticket error:', error);
      throw new ApiError(500, 'Failed to verify ticket');
    }
  }

  /**
   * Read-only ticket lookup for staff, deliberately skipping every timing
   * gate scanTicket() enforces (check-in window, event-ended, already-used).
   * Meant for the case where scanTicket() rejected a scan with "Event has
   * already ended" — the scanning app calls this instead to show full ticket
   * + order + scan-history detail rather than a bare error message.
   *
   * Uses the same member/event authorization rules as scanTicket() (a team
   * member must belong to this event's team; an organizer member/direct
   * organizerId must match the ticket's organizer) so this can't be used to
   * pull up PII for a ticket outside the caller's own event.
   */
  static async getTicketDetails({ qrCodeData, memberCode, teamMemberId, organizerId: directOrganizerId }) {
    try {
      if (!qrCodeData || (!memberCode && !teamMemberId && !directOrganizerId)) {
        throw new ApiError(
          400,
          'QR code data and member code, teamMemberId, or organizerId are required'
        );
      }

      // ── Resolve member (mirrors scanTicket's authorization rules) ────────
      let member;
      let isTeamMember = false;

      if (teamMemberId) {
        const teamMember = await db.query.eventTeamMembers.findFirst({
          where: and(eq(eventTeamMembers.id, teamMemberId), eq(eventTeamMembers.isActive, true)),
          with: { team: true },
        });
        if (!teamMember) throw new ApiError(403, 'Team member not found or inactive');
        member = { id: teamMember.id, team: teamMember.team, isTeamMember: true };
        isTeamMember = true;
      } else if (directOrganizerId) {
        member = { id: directOrganizerId, organizerId: directOrganizerId, isTeamMember: false };
      } else {
        const organizerMember = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.memberCode, memberCode),
            eq(organizerMembers.isActive, true)
          ),
          with: { organizer: true },
        });

        if (organizerMember) {
          member = {
            id: organizerMember.id,
            organizerId: organizerMember.organizerId,
            isTeamMember: false,
          };
        } else {
          const teamMember = await db.query.eventTeamMembers.findFirst({
            where: and(
              eq(eventTeamMembers.memberCode, memberCode),
              eq(eventTeamMembers.isActive, true)
            ),
            with: { team: true },
          });
          if (!teamMember) throw new ApiError(401, 'Invalid or inactive member');
          member = { id: teamMember.id, team: teamMember.team, isTeamMember: true };
          isTeamMember = true;
        }
      }

      // ── Decode QR / resolve ticketCode + eventId + organizerId ───────────
      let qrData;
      try {
        qrData = JSON.parse(qrCodeData);
      } catch {
        const plain = await db.query.purchasedTickets.findFirst({
          where: eq(purchasedTickets.ticketCode, qrCodeData),
          columns: { eventId: true, organizerId: true, ticketCode: true },
        });
        if (!plain) throw new ApiError(404, 'Ticket not found');
        qrData = {
          eventId: plain.eventId,
          organizerId: plain.organizerId,
          ticketCode: plain.ticketCode,
        };
      }

      const { eventId, organizerId, ticketCode } = qrData;
      if (!eventId || !organizerId || !ticketCode) {
        throw new ApiError(400, 'Incomplete QR code data');
      }

      // ── Authorization: same event/organizer binding rules as scanTicket ──
      if (isTeamMember) {
        if (!member.team || member.team.eventId !== eventId) {
          throw new ApiError(403, 'Team member not authorized for this event');
        }
      } else if (member.organizerId !== organizerId) {
        throw new ApiError(403, 'Member not authorized for this organizer');
      }

      // ── Regular ticket lookup ─────────────────────────────────────────────
      const ticket = await db.query.purchasedTickets.findFirst({
        where: and(
          eq(purchasedTickets.ticketCode, ticketCode),
          eq(purchasedTickets.eventId, eventId),
          eq(purchasedTickets.organizerId, organizerId)
        ),
        with: {
          event: {
            columns: { id: true, title: true, startDate: true, endDate: true, eventStatus: true },
          },
          ticketTier: { columns: { id: true, name: true, price: true } },
          eventSchedule: {
            columns: { id: true, title: true, date: true, startTime: true, endTime: true },
          },
          user: { columns: { id: true, firstName: true, lastName: true, email: true } },
          organizer: { columns: { id: true, organizationName: true } },
        },
      });

      const scanHistory = await TicketScanningService._getScanHistoryForTicket(ticketCode);

      if (ticket) {
        return {
          isGuestTicket: false,
          ticket: {
            id: ticket.id,
            ticketCode: ticket.ticketCode,
            holderName: ticket.holderName,
            holderEmail: ticket.holderEmail,
            holderPhone: ticket.holderPhone,
            price: ticket.price,
            status: ticket.status,
            isUsed: ticket.isUsed,
            usedAt: ticket.usedAt,
            firstScannedAt: ticket.firstScannedAt,
            lastScannedAt: ticket.lastScannedAt,
            scanCount: ticket.scanCount,
            purchasedAt: ticket.purchasedAt,
          },
          tier: ticket.ticketTier
            ? { id: ticket.ticketTier.id, name: ticket.ticketTier.name, price: ticket.ticketTier.price }
            : null,
          schedule: ticket.eventSchedule
            ? {
                id: ticket.eventSchedule.id,
                title: ticket.eventSchedule.title,
                date: ticket.eventSchedule.date,
                startTime: ticket.eventSchedule.startTime,
                endTime: ticket.eventSchedule.endTime,
              }
            : null,
          buyer: ticket.user
            ? {
                id: ticket.user.id,
                name: `${ticket.user.firstName} ${ticket.user.lastName}`.trim(),
                email: ticket.user.email,
              }
            : null,
          event: ticket.event,
          organizer: ticket.organizer,
          scanHistory,
        };
      }

      // ── Guest ticket fallback ─────────────────────────────────────────────
      const guestTicket = await db.query.guestPurchasedTickets.findFirst({
        where: and(
          eq(guestPurchasedTickets.ticketCode, ticketCode),
          eq(guestPurchasedTickets.eventId, eventId)
        ),
      });
      if (!guestTicket) throw new ApiError(404, 'Ticket not found or invalid');

      const [guestEvent, tier, guestOrder] = await Promise.all([
        db.query.events.findFirst({
          where: eq(events.id, eventId),
          columns: { id: true, title: true, startDate: true, endDate: true, eventStatus: true },
        }),
        db.query.eventTickets.findFirst({
          where: eq(eventTickets.id, guestTicket.ticketTierId),
          columns: { id: true, name: true, price: true },
        }),
        db.query.guestOrders.findFirst({
          where: eq(guestOrders.id, guestTicket.guestOrderId),
        }),
      ]);

      return {
        isGuestTicket: true,
        ticket: {
          id: guestTicket.id,
          ticketCode: guestTicket.ticketCode,
          holderName: guestTicket.holderName,
          holderEmail: guestTicket.holderEmail,
          holderPhone: guestTicket.holderPhone,
          price: guestTicket.price,
          status: guestTicket.status,
          isUsed: guestTicket.isUsed,
          usedAt: guestTicket.usedAt,
          scanCount: guestTicket.scanCount,
          purchasedAt: guestTicket.createdAt,
        },
        tier: tier ? { id: tier.id, name: tier.name, price: tier.price } : null,
        schedule: null,
        buyer: guestOrder ? { name: guestOrder.guestName, email: guestOrder.guestEmail } : null,
        event: guestEvent,
        organizer: { id: organizerId },
        scanHistory,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get ticket details error:', error);
      throw new ApiError(500, 'Failed to load ticket details');
    }
  }

  /**
   * Full scan audit trail for one ticket code, across all events/organizers
   * (a ticket code is unique so this is unambiguous) — used by
   * getTicketDetails() to show "scanned 3 times, last at ..." history.
   */
  static async _getScanHistoryForTicket(ticketCode) {
    const rows = await db
      .select({
        id: ticketScans.id,
        scanType: ticketScans.scanType,
        scanLocation: ticketScans.scanLocation,
        isValid: ticketScans.isValid,
        scannedAt: ticketScans.scannedAt,
        organizerMemberId: organizerMembers.id,
        organizerMemberName: organizerMembers.memberName,
        organizerMemberCode: organizerMembers.memberCode,
        teamMemberId: eventTeamMembers.id,
        teamMemberCode: eventTeamMembers.memberCode,
      })
      .from(ticketScans)
      .leftJoin(organizerMembers, eq(ticketScans.scannedBy, organizerMembers.id))
      .leftJoin(eventTeamMembers, eq(ticketScans.scannedByTeamMember, eventTeamMembers.id))
      .where(eq(ticketScans.ticketCode, ticketCode))
      .orderBy(desc(ticketScans.scannedAt));

    return rows.map(s => ({
      id: s.id,
      scanType: s.scanType,
      scanLocation: s.scanLocation,
      isValid: s.isValid,
      scannedAt: s.scannedAt,
      member: s.organizerMemberId
        ? {
            id: s.organizerMemberId,
            memberName: s.organizerMemberName,
            memberCode: s.organizerMemberCode,
            type: 'organizer',
          }
        : s.teamMemberId
          ? { id: s.teamMemberId, memberName: null, memberCode: s.teamMemberCode, type: 'team' }
          : null,
    }));
  }
}
