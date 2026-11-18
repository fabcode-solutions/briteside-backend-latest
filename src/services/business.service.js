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
} from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';
import { sendMail } from './mail.service.js';
import { BusinessCommissionService } from './businessCommission.service.js';
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
  const depositCents =
    paymentModel === 'deposit'
      ? Math.min(service.priceCents, service.depositCents ?? Math.round(service.priceCents * 0.2))
      : null;
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    imageUrl: service.imageUrl,
    categoryName: service.categoryName,
    durationMins: service.durationMins,
    priceCents: service.priceCents,
    paymentModel: service.paymentModel, // null = inherits business default
    effectivePaymentModel: paymentModel,
    depositCents: service.depositCents,
    effectiveDepositCents: depositCents,
    bufferMins: service.bufferMins,
    // [] = every staff member
    eligibleStaffIds: service.allStaff ? [] : (service.staffLinks ?? []).map(l => l.staffId),
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
  ...(includePrivate ? { userId: staff.userId } : {}),
});

const serializeBusiness = (b, { services = [], staff = [], includePrivate = false } = {}) => ({
  id: b.id,
  slug: b.slug,
  name: b.name,
  announcement: b.announcement,
  category: b.category,
  subcategory: b.subcategory,
  bio: b.bio,
  logoUrl: b.logoUrl,
  heroUrl: b.heroUrl,
  gallery: b.gallery,
  amenities: b.amenities,
  locationType: b.locationType,
  city: b.city,
  address: b.address,
  latitude: b.latitude != null ? Number(b.latitude) : null,
  longitude: b.longitude != null ? Number(b.longitude) : null,
  phone: b.phone,
  email: b.email,
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
    allowCustomerRescheduling: b.allowCustomerRescheduling,
    reschedulingNoticeDays: b.reschedulingNoticeDays,
    freeCancellationHours: b.freeCancellationHours,
    lateCancellationRefundPercent: b.lateCancellationRefundPercent,
  },
  rating: Number(b.rating ?? 0),
  reviewCount: b.reviewCount,
  services: services.map(s => serializeService(s, b)),
  staff: staff.map(s => serializeStaff(s, { includePrivate })),
  ...(includePrivate
    ? { ownerId: b.ownerId, isPublished: b.isPublished, createdAt: b.createdAt, updatedAt: b.updatedAt }
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
  const [services, staff] = await Promise.all([
    db.query.businessServices.findMany({
      where: and(eq(businessServices.businessId, businessId), isNull(businessServices.deletedAt)),
      with: { staffLinks: true },
      orderBy: [asc(businessServices.sortOrder), asc(businessServices.createdAt)],
    }),
    db.query.businessStaff.findMany({
      where: and(eq(businessStaff.businessId, businessId), isNull(businessStaff.deletedAt)),
      orderBy: [asc(businessStaff.sortOrder), asc(businessStaff.createdAt)],
    }),
  ]);
  return { services, staff };
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
    if (city) conditions.push(ilike(businesses.city, city));
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

    const minPrice = sql`(select min(s.price_cents) from ${businessServices} s where s.business_id = ${businesses.id} and s.deleted_at is null)`;
    const firstDuration = sql`(select s.duration_mins from ${businessServices} s where s.business_id = ${businesses.id} and s.deleted_at is null order by s.sort_order, s.created_at limit 1)`;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          business: businesses,
          minPriceCents: minPrice.mapWith(v => (v == null ? null : Number(v))),
          firstServiceDurationMins: firstDuration.mapWith(v => (v == null ? null : Number(v))),
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
    const [{ services, staff }, paused] = await Promise.all([
      loadServicesAndStaff(business.id),
      BusinessCommissionService.isBookingPaused(business.id),
    ]);
    // Overdue in-person commission pauses new bookings (shown as not accepting)
    return serializeBusiness(paused ? { ...business, acceptingBookings: false } : business, { services, staff });
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

  /** Onboarding: business + optional owner staff + optional first service, atomically. */
  static async create(user, body) {
    const result = await db.transaction(async tx => {
      const slug = await generateUniqueSlug(body.name, tx);
      const [business] = await tx
        .insert(businesses)
        .values({
          ownerId: user.id,
          slug,
          name: body.name,
          category: body.category,
          subcategory: emptyToNull(body.subcategory),
          bio: emptyToNull(body.bio),
          locationType: body.locationType,
          city: body.city,
          address: body.locationType === 'mobile' ? body.city : emptyToNull(body.address),
          phone: emptyToNull(body.phone),
          email: emptyToNull(body.email),
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

      if (body.ownerStaff) {
        await tx.insert(businessStaff).values({
          businessId: business.id,
          userId: user.id,
          name: body.ownerStaff.name,
          title: body.ownerStaff.title || 'Owner',
          avatarUrl: emptyToNull(body.ownerStaff.avatarUrl) ?? user.image ?? null,
        });
      }

      if (body.firstService) {
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
    const { services, staff } = await loadServicesAndStaff(business.id);
    return serializeBusiness(business, { services, staff, includePrivate: true });
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

    const values = { ...patch, updatedAt: new Date() };
    for (const k of ['subcategory', 'bio', 'address', 'phone', 'email', 'announcement']) {
      if (k in values) values[k] = emptyToNull(values[k]);
    }
    if (values.latitude !== undefined && values.latitude !== null) values.latitude = String(values.latitude);
    if (values.longitude !== undefined && values.longitude !== null) values.longitude = String(values.longitude);
    const locationType = values.locationType ?? business.locationType;
    if (locationType === 'mobile') values.address = values.city ?? business.city;

    const [updated] = await db
      .update(businesses)
      .set(values)
      .where(eq(businesses.id, business.id))
      .returning();
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
          paymentModel: body.paymentModel ?? null,
          depositCents: body.depositCents ?? null,
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
      with: { staffLinks: true },
    });
    if (!service) throw new ApiError(httpStatus.NOT_FOUND, 'Service not found');
    return serializeService(service, business);
  }

  static async updateService(business, serviceId, patch) {
    const existing = await this.getService(business, serviceId);
    assertServiceCategory(business, patch.categoryName);
    const price = patch.priceCents ?? existing.priceCents;
    const deposit = patch.depositCents !== undefined ? patch.depositCents : existing.depositCents;
    if (deposit != null && deposit > price) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Deposit cannot exceed the price');
    }

    const { eligibleStaffIds, ...rest } = patch;
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
    });
    return this.getService(business, serviceId);
  }

  /** Soft delete — existing bookings keep their reference and snapshot. */
  static async deleteService(business, serviceId) {
    await this.getService(business, serviceId);
    await db
      .update(businessServices)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(businessServices.id, serviceId));
  }

  // ── Staff ─────────────────────────────────────────────────────────────────

  static async createStaff(business, body) {
    const [staff] = await db
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
      .returning();
    return serializeStaff(staff, { includePrivate: true });
  }

  static async updateStaff(business, staffId, patch, access) {
    assertOwnStaff(access, staffId);
    await getStaffOr404(business, staffId);
    const values = { ...patch, updatedAt: new Date() };
    for (const k of ['bio', 'avatarUrl']) {
      if (k in values) values[k] = emptyToNull(values[k]);
    }
    if ('title' in values && !values.title) values.title = 'Staff';
    const [updated] = await db
      .update(businessStaff)
      .set(values)
      .where(eq(businessStaff.id, staffId))
      .returning();
    return serializeStaff(updated, { includePrivate: true });
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
    const [updated] = await db
      .update(businessStaff)
      .set(values)
      .where(eq(businessStaff.id, staffId))
      .returning();
    return serializeStaff(updated, { includePrivate: true });
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
      status: m.status,
      user: m.user ?? null,
      acceptedAt: m.acceptedAt,
      createdAt: m.createdAt,
    }));
  }

  static async invite(business, inviter, { email, role, staffId }) {
    if (staffId) await getStaffOr404(business, staffId);

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
