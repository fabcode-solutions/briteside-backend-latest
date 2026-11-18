import { z } from 'zod';
import {
  BUSINESS_CATEGORY_KEYS,
  PAYMENT_MODELS,
  LOCATION_TYPES,
  BOOKING_CONFIRMATION_MODES,
} from '../constants/businessCategories.js';
import { BUSINESS_ROLES } from '../config/business-permissions.js';

// ─── Shared pieces ──────────────────────────────────────────────────────────
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm');
const toMins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const timeWindow = z
  .object({ open: HHMM, close: HHMM })
  .refine(w => toMins(w.open) < toMins(w.close), { message: 'Opening time must be before closing time' });

// { "0": null | {open, close}, …, "6": … } — 0 = Sunday, null = closed
export const weeklyHoursSchema = z
  .record(z.enum(['0', '1', '2', '3', '4', '5', '6']), timeWindow.nullable())
  .refine(h => Object.keys(h).length === 7, { message: 'Hours must include all 7 days' });

const timezone = z.string().refine(
  tz => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid IANA timezone' }
);

const url = z.string().url().max(2048);
const optionalText = max => z.string().trim().max(max).optional().nullable();
const cents = z.number().int().min(0).max(10_000_000);
const uuid = z.string().uuid();

const businessIdParams = z.object({ businessId: uuid });

// ─── Public ─────────────────────────────────────────────────────────────────
export const listBusinessesSchema = z.object({
  query: z.object({
    q: z.string().trim().max(100).optional(),
    category: z.enum(BUSINESS_CATEGORY_KEYS).optional(),
    city: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  }),
});

export const getPublicBusinessSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
});

// ─── Owner: business ────────────────────────────────────────────────────────
export const createBusinessSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(150),
    category: z.enum(BUSINESS_CATEGORY_KEYS),
    subcategory: optionalText(100),
    bio: optionalText(5000),
    locationType: z.enum(LOCATION_TYPES).default('physical'),
    city: z.string().trim().min(1).max(120),
    address: optionalText(500),
    phone: optionalText(40),
    email: z.string().trim().email().max(255).optional().nullable().or(z.literal('')),
    timezone: timezone.optional(),
    logoUrl: url.optional().nullable(),
    heroUrl: url.optional().nullable(),
    // Post images shown on the business page
    gallery: z.array(url).max(12).optional(),
    hours: weeklyHoursSchema.optional(),
    defaultPaymentModel: z.enum(PAYMENT_MODELS).default('full'),
    // Onboarding creates the owner as the first staff member…
    ownerStaff: z
      .object({
        name: z.string().trim().min(1).max(120),
        title: z.string().trim().max(120).optional(),
        avatarUrl: url.optional().nullable(),
      })
      .optional(),
    // …and optionally a first service
    firstService: z
      .object({
        name: z.string().trim().min(1).max(150),
        durationMins: z.number().int().min(5).max(24 * 60),
        priceCents: cents,
      })
      .optional(),
  }),
});

export const updateBusinessSchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(150),
      announcement: z
        .string()
        .transform(s => s.replace(/\s+/g, ' ').trim())
        .pipe(z.string().max(100))
        .nullable(),
      category: z.enum(BUSINESS_CATEGORY_KEYS),
      subcategory: optionalText(100),
      bio: optionalText(5000),
      amenities: z.array(z.string().trim().min(1).max(60)).max(30),
      gallery: z.array(url).max(12),
      logoUrl: url.nullable(),
      heroUrl: url.nullable(),
      locationType: z.enum(LOCATION_TYPES),
      city: z.string().trim().min(1).max(120),
      address: optionalText(500),
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
      phone: optionalText(40),
      email: z.string().trim().email().max(255).nullable().or(z.literal('')),
      timezone,
      hours: weeklyHoursSchema,
      acceptingBookings: z.boolean(),
      defaultPaymentModel: z.enum(PAYMENT_MODELS),
      serviceCategories: z.array(z.string().trim().min(1).max(100)).max(50),
      isPublished: z.boolean(),
    })
    .partial()
    .refine(b => Object.keys(b).length > 0, { message: 'Nothing to update' }),
});

export const updatePoliciesSchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      cancellationPolicy: optionalText(2000),
      lateArrivalPolicy: optionalText(2000),
      noShowPolicy: optionalText(2000),
      refundPolicy: optionalText(2000),
      allowCustomerRescheduling: z.boolean(),
      reschedulingNoticeDays: z.number().int().min(0).max(365).nullable(),
      freeCancellationHours: z.number().int().min(0).max(24 * 30),
      lateCancellationRefundPercent: z.number().int().min(0).max(100),
      hours: weeklyHoursSchema,
      acceptingBookings: z.boolean(),
    })
    .partial()
    .refine(b => Object.keys(b).length > 0, { message: 'Nothing to update' }),
});

export const updateBookingQuestionsSchema = z.object({
  params: businessIdParams,
  body: z.object({
    questions: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(64).optional(),
          question: z.string().trim().min(1).max(300),
          required: z.boolean().default(false),
        })
      )
      .max(20),
  }),
});

export const businessIdOnlySchema = z.object({ params: businessIdParams });

// ─── Services ───────────────────────────────────────────────────────────────
const serviceFields = z.object({
  name: z.string().trim().min(1).max(150),
  description: optionalText(2000),
  imageUrl: url.nullable(),
  categoryName: optionalText(100),
  durationMins: z.number().int().min(5).max(24 * 60),
  priceCents: cents,
  // null = inherit business default
  paymentModel: z.enum(PAYMENT_MODELS).nullable(),
  // null = 20% of price
  depositCents: cents.nullable(),
  bufferMins: z.number().int().min(0).max(240),
  // [] = every staff member
  eligibleStaffIds: z.array(uuid).max(200),
  sortOrder: z.number().int().min(0).max(10_000),
});

const depositRefine = [
  s => s.depositCents == null || s.priceCents == null || s.depositCents <= s.priceCents,
  { message: 'Deposit cannot exceed the price', path: ['depositCents'] },
];

export const createServiceSchema = z.object({
  params: businessIdParams,
  body: serviceFields
    .partial()
    .required({ name: true, durationMins: true, priceCents: true })
    .refine(...depositRefine),
});

export const updateServiceSchema = z.object({
  params: businessIdParams.extend({ serviceId: uuid }),
  body: serviceFields
    .partial()
    .refine(...depositRefine)
    .refine(b => Object.keys(b).length > 0, { message: 'Nothing to update' }),
});

export const serviceIdSchema = z.object({
  params: businessIdParams.extend({ serviceId: uuid }),
});

// ─── Staff ──────────────────────────────────────────────────────────────────
const staffFields = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(120),
  bio: optionalText(2000),
  avatarUrl: url.nullable(),
  specialties: z.array(z.string().trim().min(1).max(60)).max(20),
  // null = follow business hours
  schedule: weeklyHoursSchema.nullable(),
  acceptingBookings: z.boolean(),
  bookingConfirmation: z.enum(BOOKING_CONFIRMATION_MODES),
  sortOrder: z.number().int().min(0).max(10_000),
});

export const createStaffSchema = z.object({
  params: businessIdParams,
  body: staffFields.partial().required({ name: true }),
});

export const updateStaffSchema = z.object({
  params: businessIdParams.extend({ staffId: uuid }),
  body: staffFields
    .partial()
    .refine(b => Object.keys(b).length > 0, { message: 'Nothing to update' }),
});

export const staffIdSchema = z.object({
  params: businessIdParams.extend({ staffId: uuid }),
});

export const updateStaffScheduleSchema = z.object({
  params: businessIdParams.extend({ staffId: uuid }),
  body: z
    .object({
      schedule: weeklyHoursSchema.nullable(),
      acceptingBookings: z.boolean(),
    })
    .partial()
    .refine(b => Object.keys(b).length > 0, { message: 'Nothing to update' }),
});

const slotWindow = z
  .object({ start: HHMM, end: HHMM })
  .refine(w => toMins(w.start) < toMins(w.end), { message: 'Start must be before end' });

// { "2026-12-01": [{start,end}, …] | [] (closed) | null (reset to weekly) }
export const upsertStaffDateOverridesSchema = z.object({
  params: businessIdParams.extend({ staffId: uuid }),
  body: z.object({
    overrides: z
      .record(
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date keys must be yyyy-MM-dd'),
        z
          .array(slotWindow)
          .max(10)
          .refine(
            slots => {
              const sorted = [...slots].sort((a, b) => toMins(a.start) - toMins(b.start));
              return sorted.every((s, i) => i === 0 || toMins(s.start) >= toMins(sorted[i - 1].end));
            },
            { message: 'Time windows cannot overlap' }
          )
          .nullable()
      )
      .refine(o => Object.keys(o).length <= 120, { message: 'Too many dates in one request' }),
  }),
});

// ─── Team ───────────────────────────────────────────────────────────────────
export const inviteTeamMemberSchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      email: z.string().trim().toLowerCase().email().max(255),
      role: z.enum(BUSINESS_ROLES),
      staffId: uuid.optional(),
    })
    .refine(b => b.role !== 'staff' || !!b.staffId, {
      message: 'staffId is required for the staff role',
      path: ['staffId'],
    }),
});

export const teamMemberIdSchema = z.object({
  params: businessIdParams.extend({ memberId: uuid }),
});

export const acceptInvitationSchema = z.object({
  params: z.object({ token: z.string().regex(/^[a-f0-9]{48}$/, 'Invalid invitation') }),
});

// ─── Bookings ───────────────────────────────────────────────────────────────
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be yyyy-MM-dd');

export const getSlotsSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  query: z.object({
    serviceId: uuid,
    staffId: uuid.optional(),
    date: isoDate,
  }),
});

export const bookingQuoteSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  query: z.object({ serviceId: uuid }),
});

export const createBookingCheckoutSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  body: z.object({
    serviceId: uuid,
    // omitted = first available staff member at that time
    staffId: uuid.optional(),
    date: isoDate,
    time: HHMM,
    customer: z
      .object({
        name: z.string().trim().min(1).max(150).optional(),
        email: z.string().trim().email().max(255).optional(),
        phone: z.string().trim().max(40).optional().nullable(),
      })
      .optional(),
    notes: z.string().trim().max(2000).optional().nullable(),
    answers: z
      .array(z.object({ questionId: z.string().min(1).max(64), answer: z.string().max(2000) }))
      .max(20)
      .optional(),
    platform: z.enum(['web', 'ios', 'android']).optional(),
    // 'native' = hold the slot and pay through the in-app card form
    // (native-intent → native-finalize); default = Stripe Checkout session
    mode: z.enum(['checkout', 'native']).optional(),
  }),
});

// In-app card form (NativeCheckoutModal): billing address for tax, and the finalize step
const billingAddressBody = z
  .object({
    country: z.string().trim().length(2).optional(),
    postalCode: z.string().trim().max(20).optional(),
    state: z.string().trim().max(60).optional(),
  })
  .optional()
  .default({});

export const nativeIntentSchema = z.object({
  params: z.object({ bookingId: uuid }),
  body: billingAddressBody,
});

export const nativeFinalizeSchema = z.object({
  params: z.object({ bookingId: uuid }),
  body: z.object({ paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9_]+$/, 'Invalid payment') }),
});

export const commissionNativeIntentSchema = z.object({
  params: z.object({ businessId: uuid, collectionId: uuid }),
  body: billingAddressBody,
});

export const commissionNativeFinalizeSchema = z.object({
  params: z.object({ businessId: uuid, collectionId: uuid }),
  body: z.object({ paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9_]+$/, 'Invalid payment') }),
});

export const checkoutSessionParamsSchema = z.object({
  params: z.object({ checkoutSessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/, 'Invalid checkout session') }),
});

const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'declined', 'no_show', 'expired'];

export const listBusinessBookingsSchema = z.object({
  params: businessIdParams,
  query: z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    status: z
      .string()
      .optional()
      .transform(s => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : undefined))
      .pipe(z.array(z.enum(BOOKING_STATUSES)).optional()),
    staffId: uuid.optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  }),
});

export const businessBookingActionSchema = z.object({
  params: businessIdParams.extend({ bookingId: uuid }),
  body: z.object({ reason: z.string().trim().max(500).optional() }).optional().default({}),
});

export const payCommissionSchema = z.object({
  params: businessIdParams,
  body: z
    .object({ platform: z.enum(['web', 'ios', 'android']).optional(), mode: z.enum(['checkout', 'native']).optional() })
    .optional()
    .default({}),
});

export const managedBookingsSchema = z.object({
  query: z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    status: z
      .string()
      .optional()
      .transform(s => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : undefined))
      .pipe(z.array(z.enum(BOOKING_STATUSES)).optional()),
    limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  }),
});

export const myBookingsSchema = z.object({
  query: z.object({ tab: z.enum(['upcoming', 'past']).optional().default('upcoming') }),
});

export const customerCancelSchema = z.object({
  params: z.object({ bookingId: uuid }),
  body: z.object({ reason: z.string().trim().max(500).optional() }).optional().default({}),
});

export const payBalanceSchema = z.object({
  params: z.object({ bookingId: uuid }),
  body: z
    .object({ platform: z.enum(['web', 'ios', 'android']).optional(), mode: z.enum(['checkout', 'native']).optional() })
    .optional()
    .default({}),
});
