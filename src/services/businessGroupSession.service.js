import httpStatus from 'http-status';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businessBookings,
  businessGroupSessions,
  businessServices,
  businessStaff,
} from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';
import { isGroup, seatsLeft } from '../utils/businessSession.js';
import {
  BusinessBookingService,
  busyForStaff,
  overlappingBookings,
  seatsTakenBySession,
} from './businessBooking.service.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const MAX_SESSIONS_PER_REQUEST = 52;
const ROSTER_STATUSES = ['pending', 'confirmed', 'completed', 'no_show'];

/**
 * Scheduled runs of a business's group services, managed from the dashboard:
 * schedule (several dates at once), list with rosters, change capacity, cancel
 * (everyone booked is refunded in full). Staff-role members: their own sessions.
 */
export class BusinessGroupSessionService {
  static async list(business, access, { from, to, serviceId } = {}) {
    const conds = [eq(businessGroupSessions.businessId, business.id)];
    conds.push(gte(businessGroupSessions.endAt, from ? new Date(from) : new Date(Date.now() - 86_400_000)));
    if (to) conds.push(lte(businessGroupSessions.startAt, new Date(to)));
    if (serviceId) conds.push(eq(businessGroupSessions.serviceId, serviceId));
    if (access?.role === 'staff') conds.push(eq(businessGroupSessions.staffId, access.staffId));

    const sessions = await db.query.businessGroupSessions.findMany({
      where: and(...conds),
      with: { staff: { columns: { id: true, name: true } }, service: { columns: { id: true, name: true } } },
      orderBy: [asc(businessGroupSessions.startAt)],
      limit: 300,
    });
    const ids = sessions.map(s => s.id);
    const [taken, roster] = await Promise.all([
      seatsTakenBySession(ids),
      ids.length
        ? db.query.businessBookings.findMany({
            where: and(
              inArray(businessBookings.groupSessionId, ids),
              inArray(businessBookings.status, ROSTER_STATUSES)
            ),
            orderBy: [asc(businessBookings.createdAt)],
          })
        : [],
    ]);
    return {
      timezone: business.timezone,
      sessions: sessions.map(s => serializeSession(s, taken.get(s.id) ?? 0, roster.filter(b => b.groupSessionId === s.id))),
    };
  }

  /**
   * Schedule one session per date at `time` (business-local). All-or-nothing:
   * if the host is busy on any date, nothing is created and the clashes are listed.
   */
  static async create(business, access, { serviceId, staffId, dates, time, capacity }) {
    if (access?.role === 'staff' && staffId !== access.staffId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You can only schedule sessions you host');
    }
    const service = await db.query.businessServices.findFirst({
      where: and(
        eq(businessServices.id, serviceId),
        eq(businessServices.businessId, business.id),
        isNull(businessServices.deletedAt)
      ),
      with: { staffLinks: true },
    });
    if (!service) throw new ApiError(httpStatus.NOT_FOUND, 'That service no longer exists. Refresh and try again.');
    if (!isGroup(service)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Set this service to "Group session" before scheduling sessions');
    }
    const staff = await db.query.businessStaff.findFirst({
      where: and(eq(businessStaff.id, staffId), eq(businessStaff.businessId, business.id), isNull(businessStaff.deletedAt)),
    });
    if (!staff) throw new ApiError(httpStatus.NOT_FOUND, 'That staff member no longer exists. Refresh and try again.');
    if (!service.allStaff && !service.staffLinks.some(l => l.staffId === staff.id)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${staff.name} doesn't offer ${service.name}. Pick another host.`);
    }

    const tz = business.timezone;
    const seats = capacity ?? service.capacity;
    const unique = [...new Set(dates)].sort();
    const now = Date.now();
    const planned = unique.map(date => {
      const start = dayjs.tz(`${date}T${time}:00`, tz);
      if (!start.isValid()) throw new ApiError(httpStatus.BAD_REQUEST, 'Pick valid dates and a start time');
      const startAt = start.toDate();
      return { date, startAt, endAt: new Date(startAt.getTime() + service.durationMins * 60_000) };
    });
    const past = planned.find(p => p.startAt.getTime() <= now);
    if (past) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${fmtDay(past.startAt, tz)} at ${fmtTime(past.startAt, tz)} has already passed`);
    }
    if (planned.some(p => p.startAt.getTime() > now + 365 * 86_400_000)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Sessions can be scheduled up to a year ahead');
    }

    const created = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'business_staff:' + staff.id}))`);
      const first = planned[0].startAt;
      const last = planned[planned.length - 1].endAt;
      const busy = await busyForStaff([staff.id], first, last, tx);
      const clashes = planned.filter(p => overlappingBookings(busy, p.startAt, p.endAt, service.bufferMins).length > 0);
      if (clashes.length) {
        const list = clashes.slice(0, 3).map(p => `${fmtDay(p.startAt, tz)} at ${fmtTime(p.startAt, tz)}`).join(', ');
        throw new ApiError(
          httpStatus.CONFLICT,
          `${staff.name} already has something booked on ${list}${clashes.length > 3 ? ` and ${clashes.length - 3} more` : ''}. Remove ${clashes.length === 1 ? 'that date' : 'those dates'} or pick another time.`,
          true,
          '',
          { code: 'SESSION_OVERLAP', dates: clashes.map(c => c.date) }
        );
      }
      return tx
        .insert(businessGroupSessions)
        .values(
          planned.map(p => ({
            businessId: business.id,
            serviceId: service.id,
            staffId: staff.id,
            startAt: p.startAt,
            endAt: p.endAt,
            bufferMins: service.bufferMins,
            capacity: seats,
          }))
        )
        .returning();
    });

    const withNames = created.map(s => ({ ...s, staff, service }));
    return { sessions: withNames.map(s => serializeSession(s, 0, [])) };
  }

  /** Change seats; never below what's already booked. */
  static async update(business, access, sessionId, { capacity }) {
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'business_group_session:' + sessionId}))`);
      const session = await loadSession(business, access, sessionId, tx);
      if (session.status !== 'scheduled') throw new ApiError(httpStatus.CONFLICT, 'This session was cancelled');
      const taken = (await seatsTakenBySession([session.id], tx)).get(session.id) ?? 0;
      if (capacity < taken) {
        throw new ApiError(
          httpStatus.CONFLICT,
          `${taken} ${taken === 1 ? 'seat is' : 'seats are'} already booked, so capacity can't go below ${taken}.`
        );
      }
      const [row] = await tx
        .update(businessGroupSessions)
        .set({ capacity, updatedAt: new Date() })
        .where(eq(businessGroupSessions.id, session.id))
        .returning();
      const roster = await tx.query.businessBookings.findMany({
        where: and(eq(businessBookings.groupSessionId, session.id), inArray(businessBookings.status, ROSTER_STATUSES)),
      });
      return { session: serializeSession({ ...row, staff: session.staff, service: session.service }, taken, roster) };
    });
  }

  /**
   * Cancel a session: no new seats, unfinished checkouts are released, and
   * everyone booked is cancelled with a full refund (booking fee included) and
   * emailed. A refund that fails is reported back; that booking stays as it is
   * so it can be cancelled again from the appointment.
   */
  static async cancel(business, access, sessionId, { reason } = {}) {
    const session = await loadSession(business, access, sessionId);
    if (session.status === 'cancelled') throw new ApiError(httpStatus.CONFLICT, 'This session is already cancelled');
    if (session.endAt.getTime() < Date.now()) {
      throw new ApiError(httpStatus.CONFLICT, "This session has already finished, so it can't be cancelled");
    }

    const [claimed] = await db
      .update(businessGroupSessions)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancellationReason: reason ?? null, updatedAt: new Date() })
      .where(and(eq(businessGroupSessions.id, session.id), eq(businessGroupSessions.status, 'scheduled')))
      .returning();
    if (!claimed) throw new ApiError(httpStatus.CONFLICT, 'This session was already updated. Refresh and try again.');

    // Checkouts in progress: release them (a payment that still lands is refunded by the webhook)
    await db
      .update(businessBookings)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(businessBookings.groupSessionId, session.id), eq(businessBookings.status, 'awaiting_payment')));

    const booked = await db.query.businessBookings.findMany({
      where: and(
        eq(businessBookings.groupSessionId, session.id),
        inArray(businessBookings.status, ['pending', 'confirmed'])
      ),
    });
    const failed = [];
    let refundedCents = 0;
    for (const b of booked) {
      try {
        // Session access was checked above — act with business-level access for each seat
        const res = await BusinessBookingService.cancelByBusiness(
          business,
          b.id,
          null,
          reason ? `Session cancelled: ${reason}` : 'Session cancelled'
        );
        refundedCents += res.refund?.refundedCents ?? 0;
      } catch (err) {
        logger.error(`[groupSession] cancel booking ${b.id} failed: ${err.message}`);
        failed.push({ bookingId: b.id, customerName: b.customerName, message: err.message });
      }
    }
    return { cancelledBookings: booked.length - failed.length, refundedCents, failed };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadSession(business, access, sessionId, tx = db) {
  const session = await tx.query.businessGroupSessions.findFirst({
    where: and(eq(businessGroupSessions.id, sessionId), eq(businessGroupSessions.businessId, business.id)),
    with: { staff: { columns: { id: true, name: true } }, service: { columns: { id: true, name: true } } },
  });
  if (!session || (access?.role === 'staff' && session.staffId !== access.staffId)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Session not found');
  }
  return session;
}

const fmtDay = (d, tz) => dayjs(d).tz(tz).format('ddd, MMM D');
const fmtTime = (d, tz) => dayjs(d).tz(tz).format('h:mm A');

function serializeSession(s, taken, roster) {
  return {
    id: s.id,
    serviceId: s.serviceId,
    serviceName: s.service?.name ?? null,
    staffId: s.staffId,
    staffName: s.staff?.name ?? null,
    startAt: s.startAt,
    endAt: s.endAt,
    capacity: s.capacity,
    seatsTaken: taken,
    seatsLeft: seatsLeft(s.capacity, taken),
    status: s.status,
    cancellationReason: s.cancellationReason ?? null,
    attendees: roster.map(b => ({
      bookingId: b.id,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      seats: b.partySize ?? 1,
      status: b.status,
      checkedInAt: b.checkedInAt ?? null,
    })),
  };
}
