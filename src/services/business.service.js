import crypto from 'crypto';
import httpStatus from 'http-status';
import slugify from 'slugify';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  users,
  businesses,
  businessStaff,
  businessStaffDateOverrides,
  businessServices,
  businessServiceStaff,
  businessTeamMembers,
  businessBookings,
  businessAddOns,
  businessQuestionnaires,
  businessGroupSessions,
  businessLocations,
} from '../db/schema/index.js';
import { normalizeQuestion } from '../utils/businessQuestionnaire.js';
import { sessionSettingsProblem } from '../utils/businessSession.js';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';
import { sendMail } from './mail.service.js';
import { BusinessCommissionService } from './businessCommission.service.js';
import { serviceDepositCents } from '../utils/businessDeposit.js';
import {
  listLocations,
  serializeLocation,
  setServiceLocations,
  setServiceOverrides,
  setStaffLocations,
  setStaffLocationSchedules,
  staffLocationMap,
  syncPrimaryFromBusiness,
} from './businessLocation.service.js';
import { emailWrapper, ctaRow, ctaButton, appUrl } from '../templates/emailLayout.js';
import {
  BUSINESS_CATEGORIES,
  DEFAULT_BUSINESS_HOURS,
} from '../constants/businessCategories.js';
import {
  calculateBusinessBookingFeeCents,
  calculateBusinessCommissionCents,
} from '../utils/orderProcessingFee.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Bookings in these states occupy staff time / block deleting things
const ACTIVE_BOOKING_STATUSES = ['awaiting_payment', 'pending', 'confirmed'];
const DATE_OVERRIDE_DAYS_AHEAD = 90;
const RESERVED_SLUGS = new Set([
  'dashboard',
  'onboarding',
  'edit-profile',
  'invitations',
  'mine',
  'categories',
  'fees',
  'bookings',
  'new',
]);

const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const emptyToNull = v => (v === '' || v === undefined ? null : v);

// ─── Serializers ────────────────────────────────────────────────────────────

const serializeService = (service, business) => {
  const paymentModel = service.paymentModel ?? business.defaultPaymentModel;
  const depositCents = paymentModel === 'deposit' ? serviceDepositCents(service) : null;
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    imageUrl: service.imageUrl,
    categoryName: service.categoryName,
    durationMins: service.durationMins,
    priceCents: service.priceCents,
    // "Inquire for pricing" — no public price / self-booking; booked through a custom offer
    priceOnRequest: !!service.priceOnRequest,
    paymentModel: service.paymentModel, // null = inherits business default
    effectivePaymentModel: paymentModel,
    depositCents: service.depositCents,
    // 1–100; when set it wins over depositCents
    depositPercent: service.depositPercent ?? null,
    effectiveDepositCents: depositCents,
    requiresApproval: !!service.requiresApproval,
    // null = the business's general booking questions
    questionnaireId: service.questionnaireId ?? null,
    // 'individual' | 'group' (priceCents per seat) | 'private_group' (priceCents per person)
    sessionType: service.sessionType ?? 'individual',
    capacity: service.capacity ?? null,
    showRemainingSeats: service.showRemainingSeats ?? true,
    minGuests: service.minGuests ?? null,
    maxGuests: service.maxGuests ?? null,
    minimumTotalCents: service.minimumTotalCents ?? null,
    bufferMins: service.bufferMins,
    // [] = every staff member
    eligibleStaffIds: service.allStaff ? [] : (service.staffLinks ?? []).map(l => l.staffId),
    // [] = offered at every location
    locationIds: (service.locationLinks ?? []).map(l => l.locationId),
    // Different price / length at some locations (null = the service's own)
    locationOverrides: (service.locationOverrides ?? []).map(o => ({
      locationId: o.locationId,
      priceCents: o.priceCents ?? null,
      durationMins: o.durationMins ?? null,
    })),
    // What the customer is charged on top (shown in booking flow)
    customerFeeCents: calculateBusinessBookingFeeCents(service.priceCents),
    sortOrder: service.sortOrder,
  };
};

const serializeStaff = (staff, { includePrivate = false } = {}) => ({
  id: staff.id,
  name: staff.name,
  title: staff.title,
  bio: staff.bio,
  avatarUrl: staff.avatarUrl,
  specialties: staff.specialties,
  schedule: staff.schedule,
  acceptingBookings: staff.acceptingBookings,
  bookingConfirmation: staff.bookingConfirmation,
  sortOrder: staff.sortOrder,
  // [] = works at every location
  locationIds: (staff.locationLinks ?? []).map(l => l.locationId),
  // { locationId: weekly hours } — when set, they're bookable at a location only in its hours
  locationSchedules: Object.fromEntries((staff.locationSchedules ?? []).map(s => [s.locationId, s.schedule])),
  ...(includePrivate ? { userId: staff.userId } : {}),
});

export const serializeAddOn = a => ({
  id: a.id,
  name: a.name,
  priceCents: a.priceCents,
  durationMins: a.durationMins,
  // [] = offered with every service
  serviceIds: a.serviceIds ?? [],
  active: a.active,
  sortOrder: a.sortOrder,
});

export const serializeQuestionnaire = (q, { includeInactive = true } = {}) => ({
  id: q.id,
  name: q.name,
  // Public page: only the questions customers are asked
  questions: (q.questions ?? []).filter(x => includeInactive || x.active !== false),
  allowAttachments: q.allowAttachments,
  sortOrder: q.sortOrder,
});

const serializeBusiness = (
  b,
  { services = [], staff = [], addOns = [], questionnaires = [], locations = [], includePrivate = false } = {}
) => ({
  id: b.id,
  slug: b.slug,
  pageType: b.pageType,
  name: b.name,
  announcement: b.announcement,
  category: b.category,
  subcategory: b.subcategory,
  bio: b.bio,
  logoUrl: b.logoUrl,
  heroUrl: b.heroUrl,
  gallery: b.gallery,
  // { url: [locationId] } — posts shown only at those locations (missing = everywhere)
  galleryLocations: b.galleryLocations ?? {},
  amenities: b.amenities,
  locationType: b.locationType,
  city: b.city,
  address: b.address,
  latitude: b.latitude != null ? Number(b.latitude) : null,
  longitude: b.longitude != null ? Number(b.longitude) : null,
  phone: b.phone,
  email: b.email,
  websiteUrl: b.websiteUrl ?? null,
  // 'inbox' → the owner's Inquiry inbox only; 'email' → also emailed to inquiryEmail
  // (dashboard only — customers never see the address)
  inquiryChannel: b.inquiryChannel ?? 'email',
  timezone: b.timezone,
  hours: b.hours,
  acceptingBookings: b.acceptingBookings,
  defaultPaymentModel: b.defaultPaymentModel,
  serviceCategories: b.serviceCategories,
  bookingQuestions: b.bookingQuestions,
  policies: {
    cancellationPolicy: b.cancellationPolicy,
    lateArrivalPolicy: b.lateArrivalPolicy,
    noShowPolicy: b.noShowPolicy,
    refundPolicy: b.refundPolicy,
    additionalPolicies: b.additionalPolicies ?? null,
    allowCustomerRescheduling: b.allowCustomerRescheduling,
    reschedulingNoticeDays: b.reschedulingNoticeDays,
    freeCancellationHours: b.freeCancellationHours,
    lateCancellationRefundPercent: b.lateCancellationRefundPercent,
  },
  rating: Number(b.rating ?? 0),
  reviewCount: b.reviewCount,
  // Branches, primary first (the flat location fields above mirror the primary)
  locations: locations.map(serializeLocation),
  services: services.map(s =>
    // "Inquire for pricing": the guide price is the owner's own note — never public
    !includePrivate && s.priceOnRequest
      ? { ...serializeService(s, b), priceCents: 0, depositCents: null, effectiveDepositCents: null, locationOverrides: [], customerFeeCents: 0 }
      : serializeService(s, b)
  ),
  staff: staff.map(s => serializeStaff(s, { includePrivate })),
  // Public: active only. Dashboard: all (inactive ones are kept but not offered).
  addOns: (includePrivate ? addOns : addOns.filter(a => a.active)).map(serializeAddOn),
  // Public: only ones a service uses, active questions only
  questionnaires: (includePrivate
    ? questionnaires
    : questionnaires.filter(q => services.some(s => s.questionnaireId === q.id))
  ).map(q => serializeQuestionnaire(q, { includeInactive: includePrivate })),
  ...(includePrivate
    ? {
        ownerId: b.ownerId,
        isPublished: b.isPublished,
        inquiryEmail: b.inquiryEmail ?? null,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      }
    : {}),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function generateUniqueSlug(name, tx = db) {
  let base =
    slugify(name, { lower: true, strict: true, trim: true }).slice(0, 100) || 'business';
  // Collide with frontend pages (/business/dashboard…) or API paths (/businesses/mine…)
  if (RESERVED_SLUGS.has(base)) base = `${base}-business`;
  const taken = await tx
    .select({ slug: businesses.slug })
    .from(businesses)
    .where(or(eq(businesses.slug, base), ilike(businesses.slug, `${base}-%`)));
  const set = new Set(taken.map(r => r.slug));
  if (!set.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

async function loadServicesAndStaff(businessId) {
  const [services, staff, addOns, questionnaires, locations] = await Promise.all([
    db.query.businessServices.findMany({
      where: and(eq(businessServices.businessId, businessId), isNull(businessServices.deletedAt)),
      with: { staffLinks: true, locationLinks: true, locationOverrides: true },
      orderBy: [asc(businessServices.sortOrder), asc(businessServices.createdAt)],
    }),
    db.query.businessStaff.findMany({
      where: and(eq(businessStaff.businessId, businessId), isNull(businessStaff.deletedAt)),
      with: { locationLinks: true, locationSchedules: true },
      orderBy: [asc(businessStaff.sortOrder), asc(businessStaff.createdAt)],
    }),
    db.query.businessAddOns.findMany({
      where: and(eq(businessAddOns.businessId, businessId), isNull(businessAddOns.deletedAt)),
      orderBy: [asc(businessAddOns.sortOrder), asc(businessAddOns.createdAt)],
    }),
    db.query.businessQuestionnaires.findMany({
      where: and(eq(businessQuestionnaires.businessId, businessId), isNull(businessQuestionnaires.deletedAt)),
      orderBy: [asc(businessQuestionnaires.sortOrder), asc(businessQuestionnaires.createdAt)],
    }),
    listLocations(businessId),
  ]);
  return { services, staff, addOns, questionnaires, locations };
}

const SESSION_FIELDS = ['sessionType', 'capacity', 'showRemainingSeats', 'minGuests', 'maxGuests', 'minimumTotalCents'];

/** Session columns for a service row — only the fields its type uses are kept. */
function sessionColumns(s) {
  const type = s.sessionType ?? 'individual';
  return {
    sessionType: type,
    capacity: type === 'group' ? s.capacity : null,
    showRemainingSeats: s.showRemainingSeats ?? true,
    minGuests: type === 'private_group' ? s.minGuests : null,
    maxGuests: type === 'private_group' ? s.maxGuests : null,
    minimumTotalCents: type === 'private_group' ? (s.minimumTotalCents ?? 0) : null,
  };
}

/** A group service with sessions still to run can't be removed or turned into another type. */
async function assertNoUpcomingSessions(serviceId, action) {
  const [upcoming] = await db
    .select({ id: businessGroupSessions.id })
    .from(businessGroupSessions)
    .where(
      and(
        eq(businessGroupSessions.serviceId, serviceId),
        eq(businessGroupSessions.status, 'scheduled'),
        gte(businessGroupSessions.endAt, new Date())
      )
    )
    .limit(1);
  if (upcoming) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `This service has upcoming group sessions. Cancel them under Group sessions before ${action}.`
    );
  }
}

/** The questionnaire must be this business's and not removed. */
async function assertQuestionnaire(businessId, questionnaireId) {
  if (!questionnaireId) return;
  const [row] = await db
    .select({ id: businessQuestionnaires.id })
    .from(businessQuestionnaires)
    .where(
      and(
        eq(businessQuestionnaires.id, questionnaireId),
        eq(businessQuestionnaires.businessId, businessId),
        isNull(businessQuestionnaires.deletedAt)
      )
    );
  if (!row) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'That questionnaire no longer exists. Pick another one or refresh the page.'
    );
  }
}

async function assertStaffBelong(businessId, staffIds, tx = db) {
  if (!staffIds?.length) return;
  const rows = await tx
    .select({ id: businessStaff.id })
    .from(businessStaff)
    .where(
      and(
        eq(businessStaff.businessId, businessId),
        inArray(businessStaff.id, staffIds),
        isNull(businessStaff.deletedAt)
      )
    );
  if (rows.length !== new Set(staffIds).size) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One or more staff members do not belong to this business');
  }
}

/** Every id is an active location of this business. */
async function assertLocationIdsBelong(businessId, ids) {
  if (!ids.length) return;
  const rows = await db
    .select({ id: businessLocations.id })
    .from(businessLocations)
    .where(
      and(
        eq(businessLocations.businessId, businessId),
        inArray(businessLocations.id, ids),
        isNull(businessLocations.deletedAt)
      )
    );
  if (rows.length !== ids.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One of the chosen locations no longer exists. Refresh and try again.');
  }
}

function assertServiceCategory(business, categoryName) {
  if (categoryName && !(business.serviceCategories ?? []).includes(categoryName)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unknown service category "${categoryName}"`);
  }
}

async function getStaffOr404(business, staffId) {
  const staff = await db.query.businessStaff.findFirst({
    where: and(
      eq(businessStaff.id, staffId),
      eq(businessStaff.businessId, business.id),
      isNull(businessStaff.deletedAt)
    ),
  });
  if (!staff) throw new ApiError(httpStatus.NOT_FOUND, 'Staff member not found');
  return staff;
}

// Role 'staff' team members may only touch their own staff record
function assertOwnStaff(access, staffId) {
  if (access?.role === 'staff' && access.staffId !== staffId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You can only manage your own schedule');
  }
}

/** True when the business can be seen publicly / take new bookings. */
export function isBusinessPublic(business, owner) {
  return !business.deletedAt && business.isPublished && !!owner?.isBritesidePlus;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class BusinessService {
  // ── Public ────────────────────────────────────────────────────────────────

  static getCategories() {
    return Object.entries(BUSINESS_CATEGORIES).map(([key, meta]) => ({ key, ...meta }));
  }

  /** Directory listing. Only published businesses whose owner has active Plus. */
  static async listPublic({ q, category, city, page = 1, limit = 20 }) {
    const conditions = [
      isNull(businesses.deletedAt),
      eq(businesses.isPublished, true),
      eq(users.isBritesidePlus, true),
    ];
    if (category) conditions.push(eq(businesses.category, category));
    // Any of the business's locations can match the city. Contains-match, so a
    // city from the user's current location ("Chicago") finds a business whose
    // city was typed with more detail ("357 Main St, Chicago, IL").
    if (city?.trim()) {
      const pattern = `%${city.trim().replace(/[\\%_]/g, m => `\\${m}`)}%`;
      conditions.push(
        or(
          ilike(businesses.city, pattern),
          sql`exists (select 1 from ${businessLocations} l where l.business_id = ${businesses.id} and l.deleted_at is null and l.city ilike ${pattern})`
        )
      );
    }
    if (q) {
      const tsQuery = q
        .split(/\s+/)
        .map(t => t.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(Boolean)
        .map(t => `${t}:*`)
        .join(' & ');
      const textMatch = tsQuery
        ? sql`${businesses.businessSearch} @@ to_tsquery('english', ${tsQuery})`
        : sql`false`;
      // Also match service names, like the frontend directory search
      conditions.push(
        or(
          textMatch,
          sql`exists (select 1 from ${businessServices} s where s.business_id = ${businesses.id} and s.deleted_at is null and s.name ilike ${'%' + q + '%'})`
        )
      );
    }
    const where = and(...conditions);
    const offset = (page - 1) * limit;

    // "Inquire for pricing" services have no public price, so they don't set the "from $X"
    const minPrice = sql`(select min(s.price_cents) from ${businessServices} s where s.business_id = ${businesses.id} and s.deleted_at is null and s.price_on_request = false)`;
    const firstDuration = sql`(select s.duration_mins from ${businessServices} s where s.business_id = ${businesses.id} and s.deleted_at is null order by s.sort_order, s.created_at limit 1)`;
    const locationCount = sql`(select count(*) from ${businessLocations} l where l.business_id = ${businesses.id} and l.deleted_at is null)`;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          business: businesses,
          minPriceCents: minPrice.mapWith(v => (v == null ? null : Number(v))),
          firstServiceDurationMins: firstDuration.mapWith(v => (v == null ? null : Number(v))),
          locationCount: locationCount.mapWith(Number),
        })
        .from(businesses)
        .innerJoin(users, eq(users.id, businesses.ownerId))
        .where(where)
        .orderBy(desc(businesses.rating), desc(businesses.reviewCount), asc(businesses.name))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql`count(*)`.mapWith(Number) })
        .from(businesses)
        .innerJoin(users, eq(users.id, businesses.ownerId))
        .where(where),
    ]);

    return {
      businesses: rows.map(r => ({
        id: r.business.id,
        slug: r.business.slug,
        pageType: r.business.pageType,
        name: r.business.name,
        category: r.business.category,
        subcategory: r.business.subcategory,
        city: r.business.city,
        locationType: r.business.locationType,
        logoUrl: r.business.logoUrl,
        heroUrl: r.business.heroUrl,
        amenities: r.business.amenities,
        hours: r.business.hours,
        timezone: r.business.timezone,
        acceptingBookings: r.business.acceptingBookings,
        defaultPaymentModel: r.business.defaultPaymentModel,
        rating: Number(r.business.rating ?? 0),
        reviewCount: r.business.reviewCount,
        minPriceCents: r.minPriceCents,
        firstServiceDurationMins: r.firstServiceDurationMins,
        locationCount: Math.max(1, r.locationCount ?? 1),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + rows.length < total,
      },
    };
  }

  /** Public profile by id or slug. 404 when hidden (unpublished / owner lost Plus). */
  static async getPublic(idOrSlug) {
    const business = await db.query.businesses.findFirst({
      where: and(
        UUID_RE.test(idOrSlug) ? eq(businesses.id, idOrSlug) : eq(businesses.slug, idOrSlug),
        isNull(businesses.deletedAt)
      ),
      with: { owner: { columns: { id: true, isBritesidePlus: true } } },
    });
    if (!business || !isBusinessPublic(business, business.owner)) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
    }
    const [{ services, staff, addOns, questionnaires, locations }, paused] = await Promise.all([
      loadServicesAndStaff(business.id),
      BusinessCommissionService.isBookingPaused(business.id),
    ]);
    // Overdue in-person commission pauses new bookings (shown as not accepting)
    return serializeBusiness(paused ? { ...business, acceptingBookings: false } : business, {
      services,
      staff,
      addOns,
      questionnaires,
      locations,
    });
  }

  // ── Owner / team ──────────────────────────────────────────────────────────

  /** Businesses the user owns or is an active team member of (for the dashboard switcher). */
  static async listMine(userId) {
    const [owned, memberships] = await Promise.all([
      db.query.businesses.findMany({
        where: and(eq(businesses.ownerId, userId), isNull(businesses.deletedAt)),
        orderBy: [asc(businesses.createdAt)],
      }),
      db.query.businessTeamMembers.findMany({
        where: and(eq(businessTeamMembers.userId, userId), eq(businessTeamMembers.status, 'active')),
        with: { business: true },
      }),
    ]);
    const pick = (b, role) => ({
      id: b.id,
      slug: b.slug,
      pageType: b.pageType,
      name: b.name,
      category: b.category,
      logoUrl: b.logoUrl,
      isPublished: b.isPublished,
      role,
    });
    return [
      ...owned.map(b => pick(b, 'owner')),
      ...memberships
        .filter(m => m.business && !m.business.deletedAt)
        .map(m => pick(m.business, m.role)),
    ];
  }

  /**
   * Onboarding: business + optional owner staff + optional first service, atomically.
   * A 'standard' page has no booking, so staff / first service are ignored for it.
   */
  static async create(user, body) {
    const isStandard = body.pageType === 'standard';
    const result = await db.transaction(async tx => {
      // One business account per user (more branches become locations of it).
      // The per-user lock stops two simultaneous creates both passing the check.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`business-owner:${user.id}`}))`);
      const [owned] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.ownerId, user.id), isNull(businesses.deletedAt)))
        .limit(1);
      if (owned) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'You already have a business. Add more branches as locations of it instead.'
        );
      }

      const slug = await generateUniqueSlug(body.name, tx);
      const [business] = await tx
        .insert(businesses)
        .values({
          ownerId: user.id,
          slug,
          pageType: isStandard ? 'standard' : 'appointments',
          name: body.name,
          category: body.category,
          subcategory: emptyToNull(body.subcategory),
          bio: emptyToNull(body.bio),
          locationType: body.locationType,
          city: body.city,
          address: body.locationType === 'mobile' ? body.city : emptyToNull(body.address),
          phone: emptyToNull(body.phone),
          email: emptyToNull(body.email),
          websiteUrl: emptyToNull(body.websiteUrl),
          // users.timezone defaults to 'UTC' — treat that as "unknown"
          timezone:
            body.timezone ??
            (user.timezone && user.timezone !== 'UTC' ? user.timezone : 'America/New_York'),
          logoUrl: emptyToNull(body.logoUrl),
          heroUrl: emptyToNull(body.heroUrl),
          gallery: body.gallery ?? [],
          hours: body.hours ?? DEFAULT_BUSINESS_HOURS,
          defaultPaymentModel: body.defaultPaymentModel,
        })
        .returning();

      // Its first (primary) location — more branches can be added from the dashboard
      await tx.insert(businessLocations).values({
        businessId: business.id,
        name: body.locationName?.trim() || business.city,
        locationType: business.locationType,
        city: business.city,
        address: business.address,
        timezone: business.timezone,
        hours: business.hours,
        isPrimary: true,
      });

      if (body.ownerStaff && !isStandard) {
        await tx.insert(businessStaff).values({
          businessId: business.id,
          userId: user.id,
          name: body.ownerStaff.name,
          title: body.ownerStaff.title || 'Owner',
          avatarUrl: emptyToNull(body.ownerStaff.avatarUrl) ?? user.image ?? null,
        });
      }

      if (body.firstService && !isStandard) {
        await tx.insert(businessServices).values({
          businessId: business.id,
          name: body.firstService.name,
          durationMins: body.firstService.durationMins,
          priceCents: body.firstService.priceCents,
        });
      }
      return business;
    });

    return this.getForManage(result);
  }

  static async getForManage(business) {
    const { services, staff, addOns, questionnaires, locations } = await loadServicesAndStaff(business.id);
    return serializeBusiness(business, {
      services,
      staff,
      addOns,
      questionnaires,
      locations,
      includePrivate: true,
    });
  }

  /**
   * Replace the business's questionnaires with `list` (edited as one library):
   * items with a known id are updated, others inserted, missing ones removed
   * (soft delete; services using them fall back to the general booking
   * questions). Past bookings keep their text snapshot either way.
   * Returns { questionnaires, unlinkedServiceIds }.
   */
  static async saveQuestionnaires(business, list) {
    const names = list.map(q => q.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Two questionnaires have the same name. Give each a different name.');
    }

    let unlinkedServiceIds = [];
    await db.transaction(async tx => {
      const existing = await tx
        .select({ id: businessQuestionnaires.id })
        .from(businessQuestionnaires)
        .where(and(eq(businessQuestionnaires.businessId, business.id), isNull(businessQuestionnaires.deletedAt)));
      const existingIds = new Set(existing.map(r => r.id));
      const keep = new Set();
      for (const [index, q] of list.entries()) {
        // Question ids must be unique within a questionnaire (answers are keyed by them)
        const seen = new Set();
        const questions = q.questions.map(raw => {
          const id = raw.id && !seen.has(raw.id) ? raw.id : crypto.randomUUID();
          seen.add(id);
          return normalizeQuestion({ ...raw, id });
        });
        const values = {
          name: q.name.trim(),
          questions,
          allowAttachments: !!q.allowAttachments,
          sortOrder: index,
          updatedAt: new Date(),
        };
        if (q.id && existingIds.has(q.id)) {
          keep.add(q.id);
          await tx.update(businessQuestionnaires).set(values).where(eq(businessQuestionnaires.id, q.id));
        } else {
          await tx.insert(businessQuestionnaires).values({ ...values, businessId: business.id });
        }
      }
      const removed = [...existingIds].filter(id => !keep.has(id));
      if (removed.length) {
        await tx
          .update(businessQuestionnaires)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(inArray(businessQuestionnaires.id, removed));
        const unlinked = await tx
          .update(businessServices)
          .set({ questionnaireId: null, updatedAt: new Date() })
          .where(
            and(eq(businessServices.businessId, business.id), inArray(businessServices.questionnaireId, removed))
          )
          .returning({ id: businessServices.id });
        unlinkedServiceIds = unlinked.map(r => r.id);
      }
    });

    const rows = await db.query.businessQuestionnaires.findMany({
      where: and(eq(businessQuestionnaires.businessId, business.id), isNull(businessQuestionnaires.deletedAt)),
      orderBy: [asc(businessQuestionnaires.sortOrder), asc(businessQuestionnaires.createdAt)],
    });
    return { questionnaires: rows.map(q => serializeQuestionnaire(q)), unlinkedServiceIds };
  }

  /**
   * Replace the business's add-ons with `list` (the dashboard edits them as one
   * list): items with an id are updated, new ones inserted, missing ones removed
   * (soft delete — past bookings keep their snapshot). Returns the saved list.
   */
  static async saveAddOns(business, list) {
    const serviceIds = [...new Set(list.flatMap(a => a.serviceIds ?? []))];
    if (serviceIds.length) {
      const found = await db
        .select({ id: businessServices.id })
        .from(businessServices)
        .where(
          and(
            eq(businessServices.businessId, business.id),
            inArray(businessServices.id, serviceIds),
            isNull(businessServices.deletedAt)
          )
        );
      if (found.length !== serviceIds.length) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'One of the chosen services no longer exists. Refresh and try again.');
      }
    }

    await db.transaction(async tx => {
      const existing = await tx
        .select({ id: businessAddOns.id })
        .from(businessAddOns)
        .where(and(eq(businessAddOns.businessId, business.id), isNull(businessAddOns.deletedAt)));
      const existingIds = new Set(existing.map(r => r.id));
      const keep = new Set();
      for (const [index, a] of list.entries()) {
        const values = {
          name: a.name,
          priceCents: a.priceCents,
          durationMins: a.durationMins ?? 0,
          serviceIds: [...new Set(a.serviceIds ?? [])],
          active: a.active ?? true,
          sortOrder: index,
          updatedAt: new Date(),
        };
        if (a.id && existingIds.has(a.id)) {
          keep.add(a.id);
          await tx.update(businessAddOns).set(values).where(eq(businessAddOns.id, a.id));
        } else {
          await tx.insert(businessAddOns).values({ ...values, businessId: business.id });
        }
      }
      const removed = [...existingIds].filter(id => !keep.has(id));
      if (removed.length) {
        await tx
          .update(businessAddOns)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(inArray(businessAddOns.id, removed));
      }
    });

    const rows = await db.query.businessAddOns.findMany({
      where: and(eq(businessAddOns.businessId, business.id), isNull(businessAddOns.deletedAt)),
      orderBy: [asc(businessAddOns.sortOrder), asc(businessAddOns.createdAt)],
    });
    return rows.map(serializeAddOn);
  }

  static async update(business, patch) {
    if (patch.serviceCategories) {
      // Don't orphan services that use a removed category
      const removed = (business.serviceCategories ?? []).filter(
        c => !patch.serviceCategories.includes(c)
      );
      if (removed.length) {
        const inUse = await db
          .select({ name: businessServices.categoryName })
          .from(businessServices)
          .where(
            and(
              eq(businessServices.businessId, business.id),
              isNull(businessServices.deletedAt),
              inArray(businessServices.categoryName, removed)
            )
          )
          .limit(1);
        if (inUse.length) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Category "${inUse[0].name}" is still used by a service`
          );
        }
      }
      const lower = patch.serviceCategories.map(c => c.toLowerCase());
      if (new Set(lower).size !== lower.length) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Duplicate service category');
      }
    }

    // A standard page can't take bookings — don't strand ones already made
    if (patch.pageType === 'standard' && business.pageType !== 'standard') {
      const active = await db
        .select({ id: businessBookings.id })
        .from(businessBookings)
        .where(
          and(
            eq(businessBookings.businessId, business.id),
            inArray(businessBookings.status, ACTIVE_BOOKING_STATUSES)
          )
        )
        .limit(1);
      if (active.length) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'Finish or cancel your upcoming bookings before switching to a standard page'
        );
      }
    }

    const { galleryLocations, ...fields } = patch;
    const values = { ...fields, updatedAt: new Date() };
    // Post → locations, sent in the same order as `gallery` ([] = every location).
    // Stored by URL; posts no longer in the gallery are dropped.
    const gallery = values.gallery ?? business.gallery ?? [];
    if (galleryLocations !== undefined) {
      const ids = [...new Set(galleryLocations.flat())];
      if (ids.length) {
        const rows = await db
          .select({ id: businessLocations.id })
          .from(businessLocations)
          .where(
            and(
              eq(businessLocations.businessId, business.id),
              inArray(businessLocations.id, ids),
              isNull(businessLocations.deletedAt)
            )
          );
        if (rows.length !== ids.length) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'One of the chosen locations no longer exists. Refresh and try again.');
        }
      }
      values.galleryLocations = Object.fromEntries(
        gallery.map((url, i) => [url, [...new Set(galleryLocations[i] ?? [])]]).filter(([, l]) => l.length)
      );
    } else if (values.gallery) {
      const kept = business.galleryLocations ?? {};
      values.galleryLocations = Object.fromEntries(Object.entries(kept).filter(([url]) => gallery.includes(url)));
    }
    for (const k of ['subcategory', 'bio', 'address', 'phone', 'email', 'announcement', 'websiteUrl', 'inquiryEmail']) {
      if (k in values) values[k] = emptyToNull(values[k]);
    }
    // Email inquiries need an address to go to (the inquiry email, else the contact email)
    if ('inquiryChannel' in values || 'inquiryEmail' in values || 'email' in values) {
      const channel = values.inquiryChannel ?? business.inquiryChannel;
      const inquiryEmail = 'inquiryEmail' in values ? values.inquiryEmail : business.inquiryEmail;
      const email = 'email' in values ? values.email : business.email;
      if (channel === 'email' && !inquiryEmail && !email) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Enter the email address inquiries should go to');
      }
    }
    if (values.latitude !== undefined && values.latitude !== null) values.latitude = String(values.latitude);
    if (values.longitude !== undefined && values.longitude !== null) values.longitude = String(values.longitude);
    const locationType = values.locationType ?? business.locationType;
    if (locationType === 'mobile') values.address = values.city ?? business.city;

    const updated = await db.transaction(async tx => {
      const [row] = await tx
        .update(businesses)
        .set(values)
        .where(eq(businesses.id, business.id))
        .returning();
      // The business-level address / hours are the primary location's
      await syncPrimaryFromBusiness(business.id, values, tx);
      return row;
    });
    return this.getForManage(updated);
  }

  static async updateBookingQuestions(business, questions) {
    const normalized = questions.map(q => ({
      id: q.id || crypto.randomUUID(),
      question: q.question,
      required: !!q.required,
    }));
    const [updated] = await db
      .update(businesses)
      .set({ bookingQuestions: normalized, updatedAt: new Date() })
      .where(eq(businesses.id, business.id))
      .returning();
    return updated.bookingQuestions;
  }

  /** Soft delete. Refused while there are upcoming active bookings. */
  static async remove(business) {
    const [upcoming] = await db
      .select({ id: businessBookings.id })
      .from(businessBookings)
      .where(
        and(
          eq(businessBookings.businessId, business.id),
          inArray(businessBookings.status, ACTIVE_BOOKING_STATUSES),
          gte(businessBookings.endAt, new Date())
        )
      )
      .limit(1);
    if (upcoming) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cancel or complete upcoming bookings before deleting this business'
      );
    }
    await db
      .update(businesses)
      .set({ deletedAt: new Date(), isPublished: false, updatedAt: new Date() })
      .where(eq(businesses.id, business.id));
  }

  // ── Services ──────────────────────────────────────────────────────────────

  static async createService(business, body) {
    assertServiceCategory(business, body.categoryName);
    const staffIds = [...new Set(body.eligibleStaffIds ?? [])];
    await assertStaffBelong(business.id, staffIds);
    await assertQuestionnaire(business.id, body.questionnaireId);
    const sessionProblem = sessionSettingsProblem(body);
    if (sessionProblem) throw new ApiError(httpStatus.BAD_REQUEST, sessionProblem);

    const id = await db.transaction(async tx => {
      const [service] = await tx
        .insert(businessServices)
        .values({
          businessId: business.id,
          name: body.name,
          description: emptyToNull(body.description),
          imageUrl: emptyToNull(body.imageUrl),
          categoryName: emptyToNull(body.categoryName),
          durationMins: body.durationMins,
          priceCents: body.priceCents,
          priceOnRequest: body.priceOnRequest ?? false,
          paymentModel: body.paymentModel ?? null,
          // At most one of the two (validation rejects both)
          depositCents: body.depositPercent != null ? null : (body.depositCents ?? null),
          depositPercent: body.depositPercent ?? null,
          requiresApproval: body.requiresApproval ?? false,
          questionnaireId: body.questionnaireId ?? null,
          ...sessionColumns(body),
          bufferMins: body.bufferMins ?? 10,
          allStaff: staffIds.length === 0,
          sortOrder: body.sortOrder ?? 0,
        })
        .returning({ id: businessServices.id });
      if (staffIds.length) {
        await tx
          .insert(businessServiceStaff)
          .values(staffIds.map(staffId => ({ serviceId: service.id, staffId })));
      }
      if (body.locationIds?.length) await setServiceLocations(business.id, service.id, body.locationIds, tx);
      if (body.locationOverrides?.length) {
        await setServiceOverrides(business.id, service.id, body.locationOverrides, tx);
      }
      return service.id;
    });
    return this.getService(business, id);
  }

  static async getService(business, serviceId) {
    const service = await db.query.businessServices.findFirst({
      where: and(
        eq(businessServices.id, serviceId),
        eq(businessServices.businessId, business.id),
        isNull(businessServices.deletedAt)
      ),
      with: { staffLinks: true, locationLinks: true, locationOverrides: true },
    });
    if (!service) throw new ApiError(httpStatus.NOT_FOUND, 'Service not found');
    return serializeService(service, business);
  }

  static async updateService(business, serviceId, patch) {
    const existing = await this.getService(business, serviceId);
    assertServiceCategory(business, patch.categoryName);
    await assertQuestionnaire(business.id, patch.questionnaireId);
    if (SESSION_FIELDS.some(k => k in patch)) {
      const merged = { ...existing, ...patch };
      const sessionProblem = sessionSettingsProblem(merged);
      if (sessionProblem) throw new ApiError(httpStatus.BAD_REQUEST, sessionProblem);
      // Its scheduled sessions would be stranded
      if (existing.sessionType === 'group' && merged.sessionType !== 'group') {
        await assertNoUpcomingSessions(serviceId, 'changing its session type');
      }
      patch = { ...patch, ...sessionColumns(merged) };
    }
    const price = patch.priceCents ?? existing.priceCents;
    // Switching deposit kind clears the other one, so only one is ever set
    if (patch.depositPercent != null) patch = { ...patch, depositCents: null };
    else if (patch.depositCents != null) patch = { ...patch, depositPercent: null };
    const deposit = patch.depositCents !== undefined ? patch.depositCents : existing.depositCents;
    const percent = patch.depositPercent !== undefined ? patch.depositPercent : existing.depositPercent;
    if (percent == null && deposit != null && deposit > price) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'The deposit can’t be more than the price');
    }

    const { eligibleStaffIds, locationIds, locationOverrides, ...rest } = patch;
    const staffIds = eligibleStaffIds ? [...new Set(eligibleStaffIds)] : null;
    if (staffIds) await assertStaffBelong(business.id, staffIds);

    await db.transaction(async tx => {
      const values = { ...rest, updatedAt: new Date() };
      for (const k of ['description', 'imageUrl', 'categoryName']) {
        if (k in values) values[k] = emptyToNull(values[k]);
      }
      if (staffIds) values.allStaff = staffIds.length === 0;
      await tx.update(businessServices).set(values).where(eq(businessServices.id, serviceId));
      if (staffIds) {
        await tx.delete(businessServiceStaff).where(eq(businessServiceStaff.serviceId, serviceId));
        if (staffIds.length) {
          await tx
            .insert(businessServiceStaff)
            .values(staffIds.map(staffId => ({ serviceId, staffId })));
        }
      }
      if (locationIds !== undefined) await setServiceLocations(business.id, serviceId, locationIds, tx);
      if (locationOverrides !== undefined) {
        await setServiceOverrides(business.id, serviceId, locationOverrides, tx);
      }
    });
    return this.getService(business, serviceId);
  }

  /** Soft delete — existing bookings keep their reference and snapshot. */
  static async deleteService(business, serviceId) {
    await this.getService(business, serviceId);
    await assertNoUpcomingSessions(serviceId, 'deleting it');
    await db
      .update(businessServices)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(businessServices.id, serviceId));
  }

  // ── Staff ─────────────────────────────────────────────────────────────────

  static async createStaff(business, body) {
    const id = await db.transaction(async tx => {
      const [staff] = await tx
        .insert(businessStaff)
        .values({
          businessId: business.id,
          name: body.name,
          title: body.title || 'Staff',
          bio: emptyToNull(body.bio),
          avatarUrl: emptyToNull(body.avatarUrl),
          specialties: body.specialties ?? [],
          schedule: body.schedule ?? null,
          acceptingBookings: body.acceptingBookings ?? true,
          bookingConfirmation: body.bookingConfirmation ?? 'automatic',
          sortOrder: body.sortOrder ?? 0,
        })
        .returning({ id: businessStaff.id });
      if (body.locationIds?.length) await setStaffLocations(business.id, staff.id, body.locationIds, tx);
      return staff.id;
    });
    return this.getStaff(id);
  }

  static async getStaff(staffId) {
    const staff = await db.query.businessStaff.findFirst({
      where: eq(businessStaff.id, staffId),
      with: { locationLinks: true, locationSchedules: true },
    });
    return serializeStaff(staff, { includePrivate: true });
  }

  /**
   * Weekly hours per location for someone who works at several ({} = one
   * schedule everywhere). Only locations they work at are kept.
   */
  static async updateStaffLocationSchedules(business, staffId, schedules, access) {
    assertOwnStaff(access, staffId);
    await getStaffOr404(business, staffId);
    const worksAt = (await staffLocationMap([staffId])).get(staffId) ?? [];
    const kept = Object.fromEntries(
      Object.entries(schedules).filter(([locationId]) => !worksAt.length || worksAt.includes(locationId))
    );
    await db.transaction(tx => setStaffLocationSchedules(business.id, staffId, kept, tx));
    return this.getStaff(staffId);
  }

  static async updateStaff(business, staffId, patch, access) {
    assertOwnStaff(access, staffId);
    await getStaffOr404(business, staffId);
    const { locationIds, ...rest } = patch;
    // Which branches someone works at is a manager decision, not a self-service one
    if (locationIds !== undefined && access?.role === 'staff') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Ask a manager to change which locations you work at');
    }
    const values = { ...rest, updatedAt: new Date() };
    for (const k of ['bio', 'avatarUrl']) {
      if (k in values) values[k] = emptyToNull(values[k]);
    }
    if ('title' in values && !values.title) values.title = 'Staff';
    await db.transaction(async tx => {
      await tx.update(businessStaff).set(values).where(eq(businessStaff.id, staffId));
      if (locationIds !== undefined) await setStaffLocations(business.id, staffId, locationIds, tx);
    });
    return this.getStaff(staffId);
  }

  /**
   * Soft delete. Refused while the staff member has upcoming active bookings.
   * Their service links are removed; services restricted to only them become
   * unbookable and are returned so the UI can warn.
   */
  static async deleteStaff(business, staffId) {
    await getStaffOr404(business, staffId);
    const [upcoming] = await db
      .select({ id: businessBookings.id })
      .from(businessBookings)
      .where(
        and(
          eq(businessBookings.staffId, staffId),
          inArray(businessBookings.status, ACTIVE_BOOKING_STATUSES),
          gte(businessBookings.endAt, new Date())
        )
      )
      .limit(1);
    if (upcoming) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This staff member has upcoming bookings. Cancel or reassign them first.'
      );
    }

    return db.transaction(async tx => {
      await tx
        .update(businessStaff)
        .set({ deletedAt: new Date(), acceptingBookings: false, updatedAt: new Date() })
        .where(eq(businessStaff.id, staffId));
      await tx.delete(businessServiceStaff).where(eq(businessServiceStaff.staffId, staffId));
      await tx
        .update(businessTeamMembers)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(and(eq(businessTeamMembers.staffId, staffId), ne(businessTeamMembers.status, 'revoked')));

      const orphaned = await tx
        .select({ id: businessServices.id, name: businessServices.name })
        .from(businessServices)
        .where(
          and(
            eq(businessServices.businessId, business.id),
            eq(businessServices.allStaff, false),
            isNull(businessServices.deletedAt),
            sql`not exists (select 1 from ${businessServiceStaff} l where l.service_id = ${businessServices.id})`
          )
        );
      return { servicesWithoutStaff: orphaned };
    });
  }

  /** Weekly schedule + accepting-bookings switch (staff role: own record only). */
  static async updateStaffSchedule(business, staffId, { schedule, acceptingBookings }, access) {
    const values = { updatedAt: new Date() };
    if (schedule !== undefined) values.schedule = schedule;
    if (acceptingBookings !== undefined) values.acceptingBookings = acceptingBookings;
    assertOwnStaff(access, staffId);
    await getStaffOr404(business, staffId);
    await db.update(businessStaff).set(values).where(eq(businessStaff.id, staffId));
    return this.getStaff(staffId);
  }

  /** { 'yyyy-MM-dd': [{start,end}] } for today … +90 days. [] = closed that day. */
  static async getStaffDateOverrides(business, staffId, access) {
    assertOwnStaff(access, staffId);
    await getStaffOr404(business, staffId);
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + DATE_OVERRIDE_DAYS_AHEAD * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = await db
      .select()
      .from(businessStaffDateOverrides)
      .where(
        and(
          eq(businessStaffDateOverrides.staffId, staffId),
          gte(businessStaffDateOverrides.overrideDate, today),
          lte(businessStaffDateOverrides.overrideDate, until)
        )
      )
      .orderBy(asc(businessStaffDateOverrides.overrideDate), asc(businessStaffDateOverrides.startTime));

    const out = {};
    for (const r of rows) {
      out[r.overrideDate] ??= [];
      if (!r.isBlocked) out[r.overrideDate].push({ start: r.startTime, end: r.endTime });
    }
    return out;
  }

  /**
   * Replace overrides per date: array of windows → those windows only,
   * [] → closed that day, null → remove override (back to weekly hours).
   */
  static async upsertStaffDateOverrides(business, staffId, overrides, access) {
    assertOwnStaff(access, staffId);
    await getStaffOr404(business, staffId);
    const dates = Object.keys(overrides);
    if (!dates.length) return this.getStaffDateOverrides(business, staffId, access);

    await db.transaction(async tx => {
      await tx
        .delete(businessStaffDateOverrides)
        .where(
          and(
            eq(businessStaffDateOverrides.staffId, staffId),
            inArray(businessStaffDateOverrides.overrideDate, dates)
          )
        );
      const rows = [];
      for (const [overrideDate, slots] of Object.entries(overrides)) {
        if (slots === null) continue;
        if (slots.length === 0) {
          rows.push({ staffId, overrideDate, isBlocked: true });
        } else {
          for (const s of slots) {
            rows.push({ staffId, overrideDate, isBlocked: false, startTime: s.start, endTime: s.end });
          }
        }
      }
      if (rows.length) await tx.insert(businessStaffDateOverrides).values(rows);
    });
    return this.getStaffDateOverrides(business, staffId, access);
  }

  // ── Team access ───────────────────────────────────────────────────────────

  static async listTeam(business) {
    const rows = await db.query.businessTeamMembers.findMany({
      where: and(
        eq(businessTeamMembers.businessId, business.id),
        ne(businessTeamMembers.status, 'revoked')
      ),
      with: {
        user: { columns: { id: true, firstName: true, lastName: true, username: true, image: true } },
      },
      orderBy: [desc(businessTeamMembers.createdAt)],
    });
    return rows.map(m => ({
      id: m.id,
      email: m.email,
      role: m.role,
      staffId: m.staffId,
      locationIds: m.locationIds ?? [],
      status: m.status,
      user: m.user ?? null,
      // Pending only — lets the business copy / resend the link by hand
      inviteUrl:
        m.status === 'pending' && m.inviteToken
          ? appUrl(`/business/invitations/${m.inviteToken}`)
          : undefined,
      acceptedAt: m.acceptedAt,
      createdAt: m.createdAt,
    }));
  }

  /**
   * Switch a dashboard member between admin and manager. Staff-role members
   * are tied to a staff record and are managed from the staff schedule instead.
   */
  static async updateMemberRole(business, actor, memberId, role, locationIds) {
    const member = await db.query.businessTeamMembers.findFirst({
      where: and(
        eq(businessTeamMembers.id, memberId),
        eq(businessTeamMembers.businessId, business.id),
        ne(businessTeamMembers.status, 'revoked')
      ),
      with: {
        user: { columns: { id: true, firstName: true, lastName: true, username: true, image: true } },
      },
    });
    if (!member) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found');
    if (member.role === 'staff') {
      throw new ApiError(httpStatus.BAD_REQUEST, "Staff access is managed from the staff member's schedule");
    }
    if (member.userId && member.userId === actor.id) {
      throw new ApiError(httpStatus.BAD_REQUEST, "You can't change your own access level");
    }

    const values = {};
    if (role && member.role !== role) values.role = role;
    if (locationIds !== undefined) {
      const ids = [...new Set(locationIds)];
      await assertLocationIdsBelong(business.id, ids);
      values.locationIds = ids;
    }
    let updated = member;
    if (Object.keys(values).length) {
      [updated] = await db
        .update(businessTeamMembers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(businessTeamMembers.id, member.id))
        .returning();
    }
    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      staffId: updated.staffId,
      locationIds: updated.locationIds ?? [],
      status: updated.status,
      user: member.user ?? null,
      inviteUrl:
        updated.status === 'pending' && updated.inviteToken
          ? appUrl(`/business/invitations/${updated.inviteToken}`)
          : undefined,
      acceptedAt: updated.acceptedAt,
      createdAt: updated.createdAt,
    };
  }

  static async invite(business, inviter, { email, role, staffId, locationIds = [] }) {
    if (staffId) await getStaffOr404(business, staffId);
    // Staff-role members are scoped by their staff record instead
    const scope = role === 'staff' ? [] : [...new Set(locationIds)];
    await assertLocationIdsBelong(business.id, scope);

    const owner = await db.query.users.findFirst({
      where: eq(users.id, business.ownerId),
      columns: { email: true },
    });
    if (owner?.email?.toLowerCase() === email) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'The owner already has full access');
    }

    const inviteToken = crypto.randomBytes(24).toString('hex');
    let member;
    try {
      [member] = await db
        .insert(businessTeamMembers)
        .values({
          businessId: business.id,
          email,
          role,
          staffId: role === 'staff' ? staffId : null,
          locationIds: scope,
          inviteToken,
          invitedBy: inviter.id,
        })
        .returning();
    } catch (err) {
      if (err?.code === '23505' || err?.cause?.code === '23505') {
        throw new ApiError(httpStatus.CONFLICT, 'This email already has access or a pending invitation');
      }
      throw err;
    }

    const inviteUrl = appUrl(`/business/invitations/${inviteToken}`);
    const roleLabel = { admin: 'an admin', manager: 'a manager', staff: 'a staff member' }[role];
    sendMail(
      email,
      `You've been invited to ${business.name} on Briteside`,
      emailWrapper(`
        <h2 style="margin:0 0 12px">Join ${escapeHtml(business.name)}</h2>
        <p>${escapeHtml(inviter.firstName || 'A team member')} invited you to help manage
        <strong>${escapeHtml(business.name)}</strong> as ${roleLabel}.</p>
        <p>Sign in with this email address (${escapeHtml(email)}) to accept.</p>
        ${ctaRow(ctaButton('Accept invitation', inviteUrl))}
      `)
    ).catch(err => logger.error(`[business] invite email failed: ${err.message}`));

    return {
      id: member.id,
      email: member.email,
      role: member.role,
      staffId: member.staffId,
      locationIds: member.locationIds ?? [],
      status: member.status,
      inviteUrl,
      createdAt: member.createdAt,
    };
  }

  static async revokeMember(business, memberId) {
    const [row] = await db
      .update(businessTeamMembers)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(
        and(
          eq(businessTeamMembers.id, memberId),
          eq(businessTeamMembers.businessId, business.id),
          ne(businessTeamMembers.status, 'revoked')
        )
      )
      .returning({ id: businessTeamMembers.id, staffId: businessTeamMembers.staffId });
    if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found');
    if (row.staffId) {
      await db
        .update(businessStaff)
        .set({ userId: null, updatedAt: new Date() })
        .where(eq(businessStaff.id, row.staffId));
    }
  }

  /** Accept by token. The signed-in account's email must match the invited email. */
  static async acceptInvitation(user, token) {
    const invite = await db.query.businessTeamMembers.findFirst({
      where: eq(businessTeamMembers.inviteToken, token),
      with: { business: true },
    });
    if (!invite || invite.status === 'revoked' || !invite.business || invite.business.deletedAt) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Invitation not found or no longer valid');
    }
    if (invite.status === 'active') {
      if (invite.userId === user.id) {
        return { businessId: invite.businessId, role: invite.role };
      }
      throw new ApiError(httpStatus.CONFLICT, 'Invitation has already been used');
    }
    if ((user.email ?? '').toLowerCase() !== invite.email.toLowerCase()) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        `This invitation was sent to ${invite.email}. Sign in with that account to accept it.`
      );
    }

    await db.transaction(async tx => {
      await tx
        .update(businessTeamMembers)
        .set({ status: 'active', userId: user.id, acceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(businessTeamMembers.id, invite.id));
      if (invite.staffId) {
        await tx
          .update(businessStaff)
          .set({ userId: user.id, updatedAt: new Date() })
          .where(eq(businessStaff.id, invite.staffId));
      }
    });
    return { businessId: invite.businessId, slug: invite.business.slug, role: invite.role };
  }

  // ── Fees (exposed for the booking flow / fee calculator) ───────────────────

  static quoteFees(servicePriceCents) {
    const customerFeeCents = calculateBusinessBookingFeeCents(servicePriceCents);
    const platformCommissionCents = calculateBusinessCommissionCents(servicePriceCents);
    return {
      servicePriceCents,
      customerFeeCents,
      customerTotalCents: servicePriceCents + customerFeeCents,
      platformCommissionCents,
      businessNetCents: servicePriceCents - platformCommissionCents,
    };
  }
}
