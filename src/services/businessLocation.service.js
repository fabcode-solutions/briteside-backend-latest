/**
 * Business locations (branches). One business account per user; a business
 * can run several locations. Each location has its own address / map pin and
 * its own weekly hours + timezone, and staff can be assigned to some of them
 * (no assignment = works at every location).
 *
 * The primary location is mirrored onto the flat location columns of
 * `businesses`, so directory search and code that predates locations keep
 * reading the business row.
 */
import httpStatus from 'http-status';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businesses,
  businessLocations,
  businessStaff,
  businessStaffLocations,
  businessServices,
  businessServiceLocations,
  businessServiceLocationOverrides,
  businessStaffLocationSchedules,
  businessLocationClosures,
  businessBookings,
  businessGroupSessions,
} from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';

const MAX_LOCATIONS = 50;
const ACTIVE_BOOKING_STATUSES = ['awaiting_payment', 'pending', 'confirmed'];
// Columns shared by a location and the business row it is mirrored onto
const MIRRORED = [
  'locationType',
  'city',
  'address',
  'latitude',
  'longitude',
  'serviceRadiusMiles',
  'timezone',
  'hours',
];

const emptyToNull = v => (v === '' || v === undefined ? null : v);
const coord = v => (v === undefined ? undefined : v === null ? null : String(v));

/**
 * Where a place is, as customers may see it. A mobile business's address and
 * pin are its home base, so customers get only the city and a centre rounded
 * to 2 decimals (~1 km) — enough to draw the service-area circle.
 * `includePrivate` (owner / team) returns the exact values.
 * `hideAddress`: the business chose to share its address only once booked
 * (privacy: hideAddressUntilBooked) — same treatment as a mobile business.
 */
export function placeFields(p, includePrivate = false, { hideAddress = false } = {}) {
  const lat = p.latitude != null ? Number(p.latitude) : null;
  const lng = p.longitude != null ? Number(p.longitude) : null;
  const hide = (p.locationType === 'mobile' || hideAddress) && !includePrivate;
  const round = v => (v == null ? null : Math.round(v * 100) / 100);
  return {
    address: hide ? p.city : p.address,
    latitude: hide ? round(lat) : lat,
    longitude: hide ? round(lng) : lng,
    serviceRadiusMiles: p.locationType === 'mobile' ? (p.serviceRadiusMiles ?? null) : null,
  };
}

export const serializeLocation = (l, { includePrivate = false, hideAddress = false } = {}) => ({
  id: l.id,
  name: l.name,
  locationType: l.locationType,
  city: l.city,
  ...placeFields(l, includePrivate, { hideAddress }),
  phone: l.phone ?? null,
  timezone: l.timezone,
  hours: l.hours,
  isPrimary: l.isPrimary,
  sortOrder: l.sortOrder,
  // Upcoming closed dates (attached by the loader)
  closures: l.closures ?? [],
});

// The location endpoints below are owner / team only
const OWNER = { includePrivate: true };

/** Active locations of a business, primary first, each with its upcoming closures. */
export async function listLocations(businessId, tx = db) {
  const rows = await tx.query.businessLocations.findMany({
    where: and(eq(businessLocations.businessId, businessId), isNull(businessLocations.deletedAt)),
    orderBy: [sql`${businessLocations.isPrimary} desc`, asc(businessLocations.sortOrder), asc(businessLocations.createdAt)],
  });
  const closures = await upcomingClosures(rows.map(r => r.id), tx);
  return rows.map(r => ({ ...r, closures: closures.get(r.id) ?? [] }));
}

/**
 * The location a request is about: the given one (must belong to the business
 * and not be removed) or, when none is given, the primary location. Falls back
 * to the business row itself for a business that somehow has no location rows.
 */
export async function resolveLocation(business, locationId, tx = db) {
  if (locationId) {
    const loc = await tx.query.businessLocations.findFirst({
      where: and(
        eq(businessLocations.id, locationId),
        eq(businessLocations.businessId, business.id),
        isNull(businessLocations.deletedAt)
      ),
    });
    if (!loc) throw new ApiError(httpStatus.NOT_FOUND, 'That location is no longer available. Please pick another.');
    return loc;
  }
  const primary = await tx.query.businessLocations.findFirst({
    where: and(
      eq(businessLocations.businessId, business.id),
      eq(businessLocations.isPrimary, true),
      isNull(businessLocations.deletedAt)
    ),
  });
  return primary ?? null;
}

/**
 * The business as seen from one location: that location's hours and timezone
 * replace the business-level ones, so slot / booking code needs no other change.
 */
export function atLocation(business, location) {
  if (!location) return { ...business, locationId: null };
  return { ...business, hours: location.hours, timezone: location.timezone, locationId: location.id };
}

/** Business viewed from a booking's (or session's) location, primary if it has none. */
export async function atRecordLocation(business, record, tx = db) {
  let loc = null;
  if (record?.locationId) {
    loc = await tx.query.businessLocations.findFirst({ where: eq(businessLocations.id, record.locationId) });
  }
  return atLocation(business, loc ?? (await resolveLocation(business, null, tx)));
}

/** { staffId: [locationId…] } for these staff (missing / [] = every location). */
export async function staffLocationMap(staffIds, tx = db) {
  const out = new Map();
  if (!staffIds.length) return out;
  const rows = await tx
    .select()
    .from(businessStaffLocations)
    .where(inArray(businessStaffLocations.staffId, staffIds));
  for (const r of rows) {
    if (!out.has(r.staffId)) out.set(r.staffId, []);
    out.get(r.staffId).push(r.locationId);
  }
  return out;
}

/** Keep only staff who work at `locationId` (null = no filtering). */
export async function filterStaffByLocation(staffList, locationId, tx = db) {
  if (!locationId || !staffList.length) return staffList;
  const map = await staffLocationMap(staffList.map(s => s.id), tx);
  return staffList.filter(s => {
    const ids = map.get(s.id);
    return !ids?.length || ids.includes(locationId);
  });
}

async function assertLocationsBelong(businessId, locationIds, tx = db) {
  if (!locationIds.length) return;
  const rows = await tx
    .select({ id: businessLocations.id })
    .from(businessLocations)
    .where(
      and(
        eq(businessLocations.businessId, businessId),
        inArray(businessLocations.id, locationIds),
        isNull(businessLocations.deletedAt)
      )
    );
  if (rows.length !== locationIds.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One of the chosen locations no longer exists. Refresh and try again.');
  }
}

/** Replace a staff member's locations ([] = every location). */
export async function setStaffLocations(businessId, staffId, locationIds, tx = db) {
  const ids = [...new Set(locationIds)];
  await assertLocationsBelong(businessId, ids, tx);
  await tx.delete(businessStaffLocations).where(eq(businessStaffLocations.staffId, staffId));
  if (ids.length) {
    await tx.insert(businessStaffLocations).values(ids.map(locationId => ({ staffId, locationId })));
  }
}

/** Replace the locations a service is offered at ([] = every location). */
export async function setServiceLocations(businessId, serviceId, locationIds, tx = db) {
  const ids = [...new Set(locationIds)];
  await assertLocationsBelong(businessId, ids, tx);
  await tx.delete(businessServiceLocations).where(eq(businessServiceLocations.serviceId, serviceId));
  if (ids.length) {
    await tx.insert(businessServiceLocations).values(ids.map(locationId => ({ serviceId, locationId })));
  }
}

/**
 * A service (loaded `with: { locationLinks: true }`) is offered at `locationId`
 * when it has no links (everywhere) or links to it. No location = no filtering.
 */
export const serviceOfferedAt = (service, locationId) =>
  !locationId || !service.locationLinks?.length || service.locationLinks.some(l => l.locationId === locationId);

// ─── Per-location price / length ────────────────────────────────────────────

/**
 * The service as booked at `locationId`: its price / length there when the
 * business set different ones (loaded `with: { locationOverrides: true }`).
 */
export function serviceAtLocation(service, locationId) {
  const o = locationId ? service.locationOverrides?.find(x => x.locationId === locationId) : null;
  if (!o) return service;
  return {
    ...service,
    priceCents: o.priceCents ?? service.priceCents,
    durationMins: o.durationMins ?? service.durationMins,
  };
}

/** Replace a service's per-location overrides ([{ locationId, priceCents?, durationMins? }]). */
export async function setServiceOverrides(businessId, serviceId, overrides, tx = db) {
  // Rows that override nothing are dropped
  const rows = overrides.filter(o => o.priceCents != null || o.durationMins != null);
  await assertLocationsBelong(businessId, [...new Set(rows.map(o => o.locationId))], tx);
  await tx
    .delete(businessServiceLocationOverrides)
    .where(eq(businessServiceLocationOverrides.serviceId, serviceId));
  if (rows.length) {
    await tx.insert(businessServiceLocationOverrides).values(
      rows.map(o => ({
        serviceId,
        locationId: o.locationId,
        priceCents: o.priceCents ?? null,
        durationMins: o.durationMins ?? null,
      }))
    );
  }
}

// ─── Per-location staff schedules ───────────────────────────────────────────

/** { staffId: { locationId: schedule } } for these staff. */
export async function staffLocationSchedules(staffIds, tx = db) {
  const out = new Map();
  if (!staffIds.length) return out;
  const rows = await tx
    .select()
    .from(businessStaffLocationSchedules)
    .where(inArray(businessStaffLocationSchedules.staffId, staffIds));
  for (const r of rows) {
    if (!out.has(r.staffId)) out.set(r.staffId, {});
    out.get(r.staffId)[r.locationId] = r.schedule;
  }
  return out;
}

const CLOSED_WEEK = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };

/**
 * The staff member as seen at one location: when they have per-location
 * schedules, that location's one applies (none there = not working there).
 */
export function staffAtLocation(staff, locationId, schedulesByStaff) {
  const mine = schedulesByStaff.get(staff.id);
  if (!locationId || !mine || !Object.keys(mine).length) return staff;
  return { ...staff, schedule: mine[locationId] ?? CLOSED_WEEK };
}

/** Replace a staff member's per-location schedules ({ locationId: schedule }; {} = none). */
export async function setStaffLocationSchedules(businessId, staffId, schedules, tx = db) {
  const ids = Object.keys(schedules);
  await assertLocationsBelong(businessId, ids, tx);
  await tx
    .delete(businessStaffLocationSchedules)
    .where(eq(businessStaffLocationSchedules.staffId, staffId));
  if (ids.length) {
    await tx
      .insert(businessStaffLocationSchedules)
      .values(ids.map(locationId => ({ staffId, locationId, schedule: schedules[locationId] })));
  }
}

// ─── Closures ───────────────────────────────────────────────────────────────

/** True when `date` (yyyy-MM-dd, location-local) falls in one of the location's closures. */
export async function isLocationClosed(locationId, date, tx = db) {
  if (!locationId) return false;
  const [row] = await tx
    .select({ id: businessLocationClosures.id })
    .from(businessLocationClosures)
    .where(
      and(
        eq(businessLocationClosures.locationId, locationId),
        lte(businessLocationClosures.startDate, date),
        gte(businessLocationClosures.endDate, date)
      )
    )
    .limit(1);
  return !!row;
}

/** Closures that haven't ended yet, per location: { locationId: [{ id, startDate, endDate, reason }] }. */
export async function upcomingClosures(locationIds, tx = db) {
  const out = new Map();
  if (!locationIds.length) return out;
  const today = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10); // a day of slack for timezones
  const rows = await tx
    .select()
    .from(businessLocationClosures)
    .where(
      and(inArray(businessLocationClosures.locationId, locationIds), gte(businessLocationClosures.endDate, today))
    )
    .orderBy(asc(businessLocationClosures.startDate));
  for (const r of rows) {
    if (!out.has(r.locationId)) out.set(r.locationId, []);
    out.get(r.locationId).push({ id: r.id, startDate: r.startDate, endDate: r.endDate, reason: r.reason ?? null });
  }
  return out;
}

// ─── Location-scoped team members ───────────────────────────────────────────

/**
 * Locations a team member is limited to (access.locationIds), or null = all.
 * A booking without a location counts as the main location's.
 */
export const scopedLocationIds = access => (access?.locationIds?.length ? access.locationIds : null);

export function assertLocationInScope(access, locationId, primaryId) {
  const scope = scopedLocationIds(access);
  if (scope && !scope.includes(locationId ?? primaryId)) {
    throw new ApiError(httpStatus.FORBIDDEN, "You don't manage that location");
  }
}

/**
 * Locations a dashboard view covers: the one asked for (must be the member's),
 * else the member's own locations, else null = the whole business.
 */
export function viewLocationIds(access, locationId) {
  const scope = scopedLocationIds(access);
  if (locationId) {
    if (scope && !scope.includes(locationId)) {
      throw new ApiError(httpStatus.FORBIDDEN, "You don't manage that location");
    }
    return [locationId];
  }
  return scope;
}

/**
 * Condition on business_bookings: visits at one of `locationIds`. Bookings from
 * before locations existed have none — they count as the primary location's.
 */
export async function bookingsAtLocations(businessId, locationIds) {
  const rows = await db
    .select({ id: businessLocations.id, isPrimary: businessLocations.isPrimary })
    .from(businessLocations)
    .where(and(eq(businessLocations.businessId, businessId), inArray(businessLocations.id, locationIds)));
  if (!rows.length) throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
  const atIds = inArray(
    businessBookings.locationId,
    rows.map(r => r.id)
  );
  return rows.some(r => r.isPrimary) ? or(atIds, isNull(businessBookings.locationId)) : atIds;
}

/** Copy a location's address / hours onto the business row (primary location only). */
async function mirrorToBusiness(location, tx) {
  const values = { updatedAt: new Date() };
  for (const k of MIRRORED) values[k] = location[k];
  await tx.update(businesses).set(values).where(eq(businesses.id, location.businessId));
}

/**
 * Business-level edits of address / hours (profile and policies forms) apply
 * to the primary location too. `patch` uses business column names.
 */
export async function syncPrimaryFromBusiness(businessId, patch, tx = db) {
  const values = {};
  for (const k of MIRRORED) if (k in patch) values[k] = patch[k];
  if (!Object.keys(values).length) return;
  await tx
    .update(businessLocations)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(
        eq(businessLocations.businessId, businessId),
        eq(businessLocations.isPrimary, true),
        isNull(businessLocations.deletedAt)
      )
    );
}

function locationValues(body, existing) {
  const values = {};
  for (const k of ['name', 'locationType', 'city', 'timezone', 'hours', 'sortOrder']) {
    if (body[k] !== undefined) values[k] = body[k];
  }
  if (body.address !== undefined) values.address = emptyToNull(body.address);
  if (body.phone !== undefined) values.phone = emptyToNull(body.phone);
  if (body.latitude !== undefined) values.latitude = coord(body.latitude);
  if (body.longitude !== undefined) values.longitude = coord(body.longitude);
  if (body.serviceRadiusMiles !== undefined) values.serviceRadiusMiles = body.serviceRadiusMiles;
  // A mobile business travels to customers: address / pin are its home base and
  // the radius is how far it goes. Physical locations have no radius.
  const type = values.locationType ?? existing?.locationType;
  if (type !== 'mobile' && (values.locationType !== undefined || values.serviceRadiusMiles !== undefined)) {
    values.serviceRadiusMiles = null;
  }
  return values;
}

/** Nothing upcoming may be stranded at a location that's being removed. */
async function assertNothingUpcomingAt(locationId) {
  const now = new Date();
  const [[booking], [session]] = await Promise.all([
    db
      .select({ id: businessBookings.id })
      .from(businessBookings)
      .where(
        and(
          eq(businessBookings.locationId, locationId),
          inArray(businessBookings.status, ACTIVE_BOOKING_STATUSES),
          gte(businessBookings.endAt, now)
        )
      )
      .limit(1),
    db
      .select({ id: businessGroupSessions.id })
      .from(businessGroupSessions)
      .where(
        and(
          eq(businessGroupSessions.locationId, locationId),
          eq(businessGroupSessions.status, 'scheduled'),
          gte(businessGroupSessions.endAt, now)
        )
      )
      .limit(1),
  ]);
  if (booking || session) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'This location has upcoming bookings or group sessions. Move or cancel them before removing it.'
    );
  }
}

export class BusinessLocationService {
  static async list(business) {
    return (await listLocations(business.id)).map(l => serializeLocation(l, OWNER));
  }

  /**
   * Close a location for a date range. Existing bookings in it are not touched —
   * the owner is told how many there are so they can move or cancel them.
   */
  static async addClosure(business, locationId, { startDate, endDate, reason }, access) {
    const location = await resolveLocation(business, locationId);
    assertLocationInScope(access, location.id);
    if (endDate < startDate) throw new ApiError(httpStatus.BAD_REQUEST, 'The end date must be on or after the start date');
    const [row] = await db
      .insert(businessLocationClosures)
      .values({ locationId: location.id, startDate, endDate, reason: emptyToNull(reason?.trim()) })
      .returning();
    // Bookings already made inside the closure (location-local dates)
    const [{ count }] = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(businessBookings)
      .where(
        and(
          eq(businessBookings.locationId, location.id),
          inArray(businessBookings.status, ACTIVE_BOOKING_STATUSES),
          sql`(${businessBookings.startAt} at time zone ${location.timezone})::date between ${startDate}::date and ${endDate}::date`
        )
      );
    return {
      closure: { id: row.id, startDate: row.startDate, endDate: row.endDate, reason: row.reason ?? null },
      affectedBookings: count,
    };
  }

  static async removeClosure(business, locationId, closureId, access) {
    const location = await resolveLocation(business, locationId);
    assertLocationInScope(access, location.id);
    const [row] = await db
      .delete(businessLocationClosures)
      .where(and(eq(businessLocationClosures.id, closureId), eq(businessLocationClosures.locationId, location.id)))
      .returning({ id: businessLocationClosures.id });
    if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Closure not found');
  }

  static async create(business, body) {
    const existing = await listLocations(business.id);
    if (existing.length >= MAX_LOCATIONS) {
      throw new ApiError(httpStatus.BAD_REQUEST, `A business can have up to ${MAX_LOCATIONS} locations`);
    }
    const isPrimary = existing.length === 0;
    const [row] = await db.transaction(async tx => {
      const inserted = await tx
        .insert(businessLocations)
        .values({
          businessId: business.id,
          locationType: 'physical',
          // New branches start with the business's hours and timezone unless given
          timezone: business.timezone,
          hours: business.hours,
          sortOrder: existing.length,
          ...locationValues(body),
          isPrimary,
        })
        .returning();
      if (isPrimary) await mirrorToBusiness(inserted[0], tx);
      return inserted;
    });
    return serializeLocation(row, OWNER);
  }

  static async update(business, locationId, body) {
    const location = await resolveLocation(business, locationId);
    const [row] = await db.transaction(async tx => {
      const updated = await tx
        .update(businessLocations)
        .set({ ...locationValues(body, location), updatedAt: new Date() })
        .where(eq(businessLocations.id, location.id))
        .returning();
      if (updated[0].isPrimary) await mirrorToBusiness(updated[0], tx);
      return updated;
    });
    return serializeLocation(row, OWNER);
  }

  /** Make this the business's main location (shown first, mirrored on the business). */
  static async makePrimary(business, locationId) {
    const location = await resolveLocation(business, locationId);
    if (location.isPrimary) return serializeLocation(location, OWNER);
    await db.transaction(async tx => {
      await tx
        .update(businessLocations)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(businessLocations.businessId, business.id), eq(businessLocations.isPrimary, true)));
      await tx
        .update(businessLocations)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(businessLocations.id, location.id));
      await mirrorToBusiness(location, tx);
    });
    return serializeLocation({ ...location, isPrimary: true }, OWNER);
  }

  /**
   * Soft delete. Not for the primary location (make another one primary first),
   * not while something upcoming is booked there, and not while a staff member
   * works only there (they'd silently start working everywhere).
   */
  static async remove(business, locationId) {
    const location = await resolveLocation(business, locationId);
    if (location.isPrimary) {
      throw new ApiError(httpStatus.CONFLICT, 'Make another location your main one before removing this one.');
    }
    await assertNothingUpcomingAt(location.id);

    const linked = await db
      .select({ staffId: businessStaffLocations.staffId })
      .from(businessStaffLocations)
      .innerJoin(businessStaff, eq(businessStaff.id, businessStaffLocations.staffId))
      .where(and(eq(businessStaffLocations.locationId, location.id), isNull(businessStaff.deletedAt)));
    if (linked.length) {
      const map = await staffLocationMap(linked.map(l => l.staffId));
      const onlyHere = linked.filter(l => (map.get(l.staffId) ?? []).every(id => id === location.id));
      if (onlyHere.length) {
        const names = await db
          .select({ name: businessStaff.name })
          .from(businessStaff)
          .where(inArray(businessStaff.id, onlyHere.map(l => l.staffId)));
        throw new ApiError(
          httpStatus.CONFLICT,
          `${names.map(n => n.name).join(', ')} only work${names.length === 1 ? 's' : ''} at this location. Assign them to another location first.`
        );
      }
    }

    // Same for services offered only here (they'd start being offered everywhere)
    const serviceLinks = await db
      .select({ serviceId: businessServiceLocations.serviceId, name: businessServices.name })
      .from(businessServiceLocations)
      .innerJoin(businessServices, eq(businessServices.id, businessServiceLocations.serviceId))
      .where(and(eq(businessServiceLocations.locationId, location.id), isNull(businessServices.deletedAt)));
    if (serviceLinks.length) {
      const all = await db
        .select()
        .from(businessServiceLocations)
        .where(inArray(businessServiceLocations.serviceId, serviceLinks.map(s => s.serviceId)));
      const onlyHere = serviceLinks.filter(s =>
        all.filter(l => l.serviceId === s.serviceId).every(l => l.locationId === location.id)
      );
      if (onlyHere.length) {
        throw new ApiError(
          httpStatus.CONFLICT,
          `${onlyHere.map(s => s.name).join(', ')} ${onlyHere.length === 1 ? 'is' : 'are'} only offered at this location. Offer ${onlyHere.length === 1 ? 'it' : 'them'} at another location (or delete ${onlyHere.length === 1 ? 'it' : 'them'}) first.`
        );
      }
    }

    await db.transaction(async tx => {
      await tx
        .update(businessLocations)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(businessLocations.id, location.id));
      await tx.delete(businessStaffLocations).where(eq(businessStaffLocations.locationId, location.id));
      await tx.delete(businessServiceLocations).where(eq(businessServiceLocations.locationId, location.id));
    });
  }
}
