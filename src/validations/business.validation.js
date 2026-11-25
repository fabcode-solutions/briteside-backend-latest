import { z } from 'zod';
import {
  BUSINESS_CATEGORY_KEYS,
  PAYMENT_MODELS,
  LOCATION_TYPES,
  PAGE_TYPES,
  BOOKING_CONFIRMATION_MODES,
} from '../constants/businessCategories.js';
import { BUSINESS_ROLES } from '../config/business-permissions.js';
import {
  ATTACHMENT_MAX_FILES,
  LONG_ANSWER_MAX,
  MAX_OPTIONS,
  MAX_QUESTIONNAIRES,
  MAX_QUESTIONS,
  OPTION_QUESTION_TYPES,
  QUESTION_TYPES,
} from '../utils/businessQuestionnaire.js';
import { MAX_PARTY_SIZE, SESSION_TYPES } from '../utils/businessSession.js';

// Dates per "schedule sessions" request (weekly for a year)
const MAX_SESSIONS_PER_REQUEST = 52;

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
const INQUIRY_CHANNELS = ['inbox', 'email'];
// Public links: http(s) only, so a javascript:/data: link can't end up on the page
const httpLink = message =>
  z
    .string()
    .trim()
    .max(2048)
    .refine(
      v => {
        if (v === '') return true;
        try {
          const u = new URL(v);
          return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname.includes('.');
        } catch {
          return false;
        }
      },
      { message }
    )
    .nullable();
const websiteUrl = httpLink('Website must be a full http:// or https:// address');
// Reserve Now target (their OpenTable / Resy / Tock… page)
const reservationUrl = httpLink('Reservation link must be a full http:// or https:// address');
const optionalText = max => z.string().trim().max(max).optional().nullable();
const cents = z.number().int().min(0).max(10_000_000);
const uuid = z.string().uuid();

const businessIdParams = z.object({ businessId: uuid });

// ─── Public ─────────────────────────────────────────────────────────────────
export const listBusinessesSchema = z.object({
  query: z
    .object({
      q: z.string().trim().max(100).optional(),
      category: z.enum(BUSINESS_CATEGORY_KEYS).optional(),
      city: z.string().trim().max(120).optional(),
      // Searcher's point: businesses within `radius` miles of it, plus mobile
      // businesses whose own service area covers it. Nearest first.
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radius: z.coerce.number().int().min(1).max(250).optional().default(25),
      page: z.coerce.number().int().min(1).optional().default(1),
      limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    })
    .refine(q => (q.lat === undefined) === (q.lng === undefined), {
      message: 'Send both lat and lng',
      path: ['lat'],
    }),
});

export const getPublicBusinessSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
});

// The business's @username — also its public URL key (/business/:handle).
// Lowercase letters, numbers, _ and -; starts and ends with a letter or number.
export const BUSINESS_HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;
const businessHandle = z
  .string()
  .trim()
  .transform(s => s.replace(/^@/, '').toLowerCase())
  .pipe(
    z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(30, 'Username can be up to 30 characters')
      .regex(
        BUSINESS_HANDLE_RE,
        'Username can use letters, numbers, _ and -, and must start and end with a letter or number'
      )
  );

export const handleAvailableSchema = z.object({
  query: z.object({
    handle: z.string().trim().min(1).max(60),
    // A renaming business: its own recently released names are available to it
    businessId: uuid.optional(),
  }),
});

// ─── Owner: business ────────────────────────────────────────────────────────
// Mobile businesses: how far (miles) they travel from their home base
const serviceRadiusMiles = z
  .number()
  .int('Use whole miles')
  .min(1, 'Service radius must be at least 1 mile')
  .max(250, 'Service radius can be up to 250 miles')
  .nullable();

export const createBusinessSchema = z.object({
  body: z.object({
    // 'standard' = profile page without booking (no staff / services)
    pageType: z.enum(PAGE_TYPES).default('appointments'),
    name: z.string().trim().min(1).max(150),
    // @username; generated from the name when omitted (older clients)
    handle: businessHandle.optional(),
    category: z.enum(BUSINESS_CATEGORY_KEYS),
    subcategory: optionalText(100),
    bio: optionalText(5000),
    locationType: z.enum(LOCATION_TYPES).default('physical'),
    city: z.string().trim().min(1).max(120),
    address: optionalText(500),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    serviceRadiusMiles: serviceRadiusMiles.optional(),
    // Label of the first location (defaults to the city)
    locationName: optionalText(120),
    phone: optionalText(40),
    email: z.string().trim().email().max(255).optional().nullable().or(z.literal('')),
    websiteUrl: websiteUrl.optional(),
    reservationUrl: reservationUrl.optional(),
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
      pageType: z.enum(PAGE_TYPES),
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
      // Same order as `gallery`: the locations each post shows at ([] = every location)
      galleryLocations: z.array(z.array(uuid).max(50)).max(12),
      logoUrl: url.nullable(),
      heroUrl: url.nullable(),
      locationType: z.enum(LOCATION_TYPES),
      city: z.string().trim().min(1).max(120),
      address: optionalText(500),
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
      serviceRadiusMiles,
      phone: optionalText(40),
      email: z.string().trim().email().max(255).nullable().or(z.literal('')),
      websiteUrl,
      reservationUrl,
      // Where "Send inquiry" goes; 'email' uses inquiryEmail (or the contact email)
      inquiryChannel: z.enum(INQUIRY_CHANNELS),
      inquiryEmail: z.string().trim().email().max(255).nullable().or(z.literal('')),
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

// Sign-up: the business type and @username to resume onboarding with
export const savePendingSetupSchema = z.object({
  body: z.object({
    category: z.enum(BUSINESS_CATEGORY_KEYS),
    subcategory: optionalText(100),
    handle: businessHandle,
  }),
});

// Change the business's @username (and with it the page URL)
export const updateHandleSchema = z.object({
  params: businessIdParams,
  body: z.object({ handle: businessHandle }),
});

export const updatePoliciesSchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      cancellationPolicy: optionalText(2000),
      lateArrivalPolicy: optionalText(2000),
      noShowPolicy: optionalText(2000),
      refundPolicy: optionalText(2000),
      additionalPolicies: optionalText(4000),
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

// ─── Locations (branches) ───────────────────────────────────────────────────
const locationFields = z.object({
  name: z.string().trim().min(1, 'Name the location').max(120, 'Location names can be up to 120 characters'),
  locationType: z.enum(LOCATION_TYPES),
  city: z.string().trim().min(1, 'City is required').max(120),
  address: optionalText(500),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  serviceRadiusMiles,
  phone: optionalText(40),
  timezone,
  hours: weeklyHoursSchema,
  sortOrder: z.number().int().min(0).max(10_000),
});

const locationParams = businessIdParams.extend({ locationId: uuid });

export const createLocationSchema = z.object({
  params: businessIdParams,
  body: locationFields.partial().required({ name: true, city: true }),
});

export const updateLocationSchema = z.object({
  params: locationParams,
  body: locationFields.partial().refine(b => Object.keys(b).length > 0, { message: 'Nothing to update' }),
});

export const locationIdSchema = z.object({ params: locationParams });

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be yyyy-MM-dd');

export const addLocationClosureSchema = z.object({
  params: locationParams,
  body: z
    .object({
      startDate: ymd,
      endDate: ymd,
      reason: z.string().trim().max(120).optional().nullable(),
    })
    .refine(b => b.endDate >= b.startDate, { message: 'The end date must be on or after the start date', path: ['endDate'] }),
});

export const locationClosureIdSchema = z.object({
  params: locationParams.extend({ closureId: uuid }),
});

export const updateStaffLocationSchedulesSchema = z.object({
  params: businessIdParams.extend({ staffId: uuid }),
  // { locationId: weekly hours }; {} = one schedule at every location
  body: z.object({
    schedules: z
      .record(uuid, weeklyHoursSchema)
      .refine(s => Object.keys(s).length <= 50, { message: 'Too many locations' }),
  }),
});

// ─── Services ───────────────────────────────────────────────────────────────
const serviceFields = z.object({
  name: z.string().trim().min(1).max(150),
  description: optionalText(2000),
  imageUrl: url.nullable(),
  categoryName: optionalText(100),
  durationMins: z.number().int().min(5).max(24 * 60),
  priceCents: cents,
  // "Price depends on the job but starts from priceCents": shown as "From $X" with an
  // Inquire button instead of Book; customers inquire and get a custom offer
  priceOnRequest: z.boolean(),
  // null = inherit business default
  paymentModel: z.enum(PAYMENT_MODELS).nullable(),
  // Deposit: a fixed amount OR a percentage of the price (neither = 20%)
  depositCents: cents.nullable(),
  depositPercent: z
    .number()
    .int('Deposit percentage must be a whole number')
    .min(1, 'Deposit percentage must be at least 1%')
    .max(100, 'Deposit percentage can’t be more than 100%')
    .nullable(),
  // Bookings arrive as requests the business accepts or declines
  requiresApproval: z.boolean(),
  // null = the business's general booking questions
  questionnaireId: uuid.nullable(),
  // Group session (seats in scheduled sessions) / private group event (guests × price, with a minimum)
  sessionType: z.enum(SESSION_TYPES, { message: 'Choose a session type' }),
  capacity: z
    .number()
    .int('Seats must be a whole number')
    .min(1, 'A session needs at least 1 seat')
    .max(MAX_PARTY_SIZE, `Up to ${MAX_PARTY_SIZE} seats`)
    .nullable(),
  showRemainingSeats: z.boolean(),
  minGuests: z.number().int('Use a whole number of guests').min(1, 'At least 1 guest').max(MAX_PARTY_SIZE).nullable(),
  maxGuests: z.number().int('Use a whole number of guests').min(1, 'At least 1 guest').max(MAX_PARTY_SIZE).nullable(),
  minimumTotalCents: cents.nullable(),
  bufferMins: z.number().int().min(0).max(240),
  // [] = every staff member
  eligibleStaffIds: z.array(uuid).max(200),
  // [] = offered at every location
  locationIds: z.array(uuid).max(50),
  // Different price / length at some locations (null = the service's own)
  locationOverrides: z
    .array(
      z.object({
        locationId: uuid,
        priceCents: cents.nullable().optional(),
        durationMins: z.number().int().min(5).max(24 * 60).nullable().optional(),
      })
    )
    .max(50),
  sortOrder: z.number().int().min(0).max(10_000),
});

const depositRefine = [
  s => s.depositCents == null || s.priceCents == null || s.depositCents <= s.priceCents,
  { message: 'The deposit can’t be more than the price', path: ['depositCents'] },
];
const oneDepositKind = [
  s => s.depositCents == null || s.depositPercent == null,
  { message: 'Set the deposit as an amount or a percentage, not both', path: ['depositPercent'] },
];

export const createServiceSchema = z.object({
  params: businessIdParams,
  body: serviceFields
    .partial()
    .required({ name: true, durationMins: true, priceCents: true })
    .refine(...depositRefine)
    .refine(...oneDepositKind),
});

export const updateServiceSchema = z.object({
  params: businessIdParams.extend({ serviceId: uuid }),
  body: serviceFields
    .partial()
    .refine(...depositRefine)
    .refine(...oneDepositKind)
    .refine(b => Object.keys(b).length > 0, { message: 'Nothing to update' }),
});

// Start / schedule / end a sale on several services. salePercent null = end it.
export const setServiceSaleSchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      serviceIds: z.array(uuid).min(1, 'Choose at least one service').max(200),
      salePercent: z
        .number()
        .int('Use a whole percentage')
        .min(1, 'The sale needs to be at least 1% off')
        .max(90, 'A sale can be up to 90% off')
        .nullable(),
      // null start = starts now; null end = runs until you end it
      saleStartsAt: z.string().datetime({ offset: true }).nullable().optional(),
      saleEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .refine(b => b.salePercent == null || !b.saleEndsAt || new Date(b.saleEndsAt).getTime() > Date.now(), {
      message: 'The end time has already passed',
      path: ['saleEndsAt'],
    })
    .refine(
      b =>
        b.salePercent == null ||
        !b.saleStartsAt ||
        !b.saleEndsAt ||
        new Date(b.saleEndsAt).getTime() > new Date(b.saleStartsAt).getTime(),
      { message: 'The sale has to end after it starts', path: ['saleEndsAt'] }
    ),
});

export const saveAddOnsSchema = z.object({
  params: businessIdParams,
  body: z.object({
    addOns: z
      .array(
        z.object({
          id: uuid.optional(),
          name: z.string().trim().min(1, 'Every add-on needs a name').max(120, 'Add-on names can be up to 120 characters'),
          priceCents: cents,
          durationMins: z
            .number()
            .int('Extra minutes must be a whole number')
            .min(0, 'Extra minutes can’t be negative')
            .max(480, 'Extra minutes can be up to 8 hours'),
          // [] = every service
          serviceIds: z.array(uuid).max(200).optional(),
          active: z.boolean().optional(),
        })
      )
      .max(50, 'You can have up to 50 add-ons'),
  }),
});

export const serviceIdSchema = z.object({
  params: businessIdParams.extend({ serviceId: uuid }),
});

// ─── Questionnaires ─────────────────────────────────────────────────────────
const questionnaireQuestion = z
  .object({
    // Client-made id (answers are keyed by it); the server fills in missing / duplicate ones
    id: z.string().trim().min(1).max(64).regex(/^[\w-]+$/, 'Invalid question id').optional(),
    label: z
      .string()
      .trim()
      .min(1, 'Every question needs text')
      .max(300, 'Questions can be up to 300 characters'),
    type: z.enum(QUESTION_TYPES, { message: 'Pick an answer type for each question' }),
    options: z
      .array(z.string().trim().max(120, 'Options can be up to 120 characters'))
      .max(MAX_OPTIONS, `Up to ${MAX_OPTIONS} options per question`)
      .optional()
      .default([]),
    required: z.boolean().optional().default(false),
    active: z.boolean().optional().default(true),
    placeholder: z.string().trim().max(120).optional().nullable(),
  })
  .refine(q => !OPTION_QUESTION_TYPES.includes(q.type) || q.options.some(o => o.length > 0), {
    message: 'Add at least one option to each choice question',
    path: ['options'],
  });

export const saveQuestionnairesSchema = z.object({
  params: businessIdParams,
  body: z.object({
    questionnaires: z
      .array(
        z.object({
          id: uuid.optional(),
          name: z
            .string()
            .trim()
            .min(1, 'Every questionnaire needs a name')
            .max(120, 'Names can be up to 120 characters'),
          questions: z.array(questionnaireQuestion).max(MAX_QUESTIONS, `Up to ${MAX_QUESTIONS} questions each`),
          allowAttachments: z.boolean().optional().default(false),
        })
      )
      .max(MAX_QUESTIONNAIRES, `You can have up to ${MAX_QUESTIONNAIRES} questionnaires`),
  }),
});

const attachmentIndex = z.coerce.number().int().min(0).max(ATTACHMENT_MAX_FILES - 1);

export const businessAttachmentSchema = z.object({
  params: businessIdParams.extend({ bookingId: uuid, index: attachmentIndex }),
});

export const customerAttachmentSchema = z.object({
  params: z.object({ bookingId: uuid, index: attachmentIndex }),
});

export const uploadBookingAttachmentSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
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
  // [] = works at every location
  locationIds: z.array(uuid).max(50),
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
      // Admins / managers: limit to these locations ([] = every location)
      locationIds: z.array(uuid).max(50).optional(),
    })
    .refine(b => b.role !== 'staff' || !!b.staffId, {
      message: 'staffId is required for the staff role',
      path: ['staffId'],
    }),
});

export const teamMemberIdSchema = z.object({
  params: businessIdParams.extend({ memberId: uuid }),
});

export const updateTeamMemberSchema = z.object({
  params: businessIdParams.extend({ memberId: uuid }),
  body: z
    .object({
      role: z.enum(['admin', 'manager']).optional(),
      // [] = every location
      locationIds: z.array(uuid).max(50).optional(),
    })
    .refine(b => b.role !== undefined || b.locationIds !== undefined, { message: 'Nothing to update' }),
});

export const acceptInvitationSchema = z.object({
  params: z.object({ token: z.string().regex(/^[a-f0-9]{48}$/, 'Invalid invitation') }),
});

// ─── Bookings ───────────────────────────────────────────────────────────────
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be yyyy-MM-dd');

// ?addOnIds=a,b → ['a','b'] (query strings can't carry arrays cleanly)
const addOnIdsQuery = z
  .string()
  .optional()
  .transform(s => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : []))
  .pipe(z.array(uuid).max(20, 'Pick up to 20 add-ons'));

export const getSlotsSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  query: z
    .object({
      serviceId: uuid.optional(),
      // Booking a custom price offer: its length / staff apply (service may be a one-off)
      offerId: uuid.optional(),
      staffId: uuid.optional(),
      // Omitted = the business's main location
      locationId: uuid.optional(),
      date: isoDate,
      addOnIds: addOnIdsQuery,
    })
    .refine(q => !!q.serviceId || !!q.offerId, { message: 'Pick a service', path: ['serviceId'] }),
});

export const bookingQuoteSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  query: z.object({
    serviceId: uuid,
    // The location's own price applies when it has one
    locationId: uuid.optional(),
    addOnIds: addOnIdsQuery,
    partySize: z.coerce.number().int().min(1).max(MAX_PARTY_SIZE).optional(),
  }),
});

export const publicGroupSessionsSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  query: z.object({ serviceId: uuid, locationId: uuid.optional() }),
});

// ─── Group sessions (dashboard) ─────────────────────────────────────────────
export const listGroupSessionsSchema = z.object({
  params: businessIdParams,
  query: z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    serviceId: uuid.optional(),
    locationId: uuid.optional(),
  }),
});

export const createGroupSessionsSchema = z.object({
  params: businessIdParams,
  body: z.object({
    serviceId: uuid,
    staffId: uuid,
    // Omitted = the business's main location
    locationId: uuid.optional(),
    dates: z
      .array(isoDate)
      .min(1, 'Pick at least one date')
      .max(MAX_SESSIONS_PER_REQUEST, `Up to ${MAX_SESSIONS_PER_REQUEST} dates at a time`),
    time: HHMM,
    // Omitted = the service's seats
    capacity: z.number().int().min(1, 'At least 1 seat').max(MAX_PARTY_SIZE).optional(),
  }),
});

const groupSessionParams = businessIdParams.extend({ sessionId: uuid });

export const updateGroupSessionSchema = z.object({
  params: groupSessionParams,
  body: z.object({
    capacity: z.number().int('Seats must be a whole number').min(1, 'At least 1 seat').max(MAX_PARTY_SIZE),
  }),
});

export const cancelGroupSessionSchema = z.object({
  params: groupSessionParams,
  body: z.object({ reason: z.string().trim().max(500).optional() }).optional().default({}),
});

export const createBookingCheckoutSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  body: z.object({
    serviceId: uuid.optional(),
    // Booking a custom price offer (signed-in customer it was sent to): its price,
    // length and payment terms replace the service's; add-ons don't apply
    offerId: uuid.optional(),
    // omitted = first available staff member at that time
    staffId: uuid.optional(),
    // Branch to book at (omitted = main location; group sessions use their own)
    locationId: uuid.optional(),
    // Optional extras; their price and minutes are added to the booking
    addOnIds: z.array(uuid).max(20, 'Pick up to 20 add-ons').optional(),
    // Group services: the session to book seats in (date / time come from it)
    groupSessionId: uuid.optional(),
    // Seats (group session) or guests (private event)
    partySize: z.number().int().min(1).max(MAX_PARTY_SIZE).optional(),
    date: isoDate.optional(),
    time: HHMM.optional(),
    customer: z
      .object({
        name: z.string().trim().min(1).max(150).optional(),
        email: z.string().trim().email().max(255).optional(),
        phone: z.string().trim().max(40).optional().nullable(),
      })
      .optional(),
    notes: z.string().trim().max(2000).optional().nullable(),
    // text | one option | ticked options | yes/no — checked against the questions in the service
    answers: z
      .array(
        z.object({
          questionId: z.string().min(1).max(64),
          answer: z.union([
            z.string().max(LONG_ANSWER_MAX),
            z.array(z.string().max(120)).max(MAX_OPTIONS),
            z.boolean(),
          ]),
        })
      )
      .max(MAX_QUESTIONS)
      .optional(),
    // Files uploaded first via POST /:idOrSlug/booking-attachments (signed-in customers)
    attachments: z
      .array(z.object({ key: z.string().min(1).max(500), name: z.string().trim().max(200).optional() }))
      .max(ATTACHMENT_MAX_FILES, `You can attach up to ${ATTACHMENT_MAX_FILES} files`)
      .optional(),
    platform: z.enum(['web', 'ios', 'android']).optional(),
    // 'native' = hold the slot and pay through the in-app card form
    // (native-intent → native-finalize); default = Stripe Checkout session
    mode: z.enum(['checkout', 'native']).optional(),
  })
    .refine(b => !!b.groupSessionId || (!!b.date && !!b.time), {
      message: 'Pick a date and time',
      path: ['time'],
    })
    .refine(b => !!b.serviceId || !!b.offerId, { message: 'Pick a service', path: ['serviceId'] }),
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
    locationId: uuid.optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  }),
});

export const businessBookingActionSchema = z.object({
  params: businessIdParams.extend({ bookingId: uuid }),
  body: z.object({ reason: z.string().trim().max(500).optional() }).optional().default({}),
});

export const completeBookingSchema = z.object({
  params: businessIdParams.extend({ bookingId: uuid }),
  body: z
    .object({
      // Extras done on the day, collected in person (5% commission applies)
      charges: z
        .array(
          z.object({
            label: z.string().trim().min(1, 'Describe each extra charge').max(80),
            amountCents: cents.min(1, 'Each extra charge must be above $0'),
          })
        )
        .max(20, 'Add up to 20 extra charges')
        .optional(),
    })
    .optional()
    .default({}),
});

export const checkInSchema = z.object({
  params: businessIdParams.extend({ bookingId: uuid }),
  body: z.object({ undo: z.boolean().optional() }).optional().default({}),
});

export const manualBookingSchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      customer: z
        .object({
          name: z.string().trim().min(1, "Enter the customer's name").max(150),
          email: z.string().trim().email('Enter a valid email').max(255).optional().or(z.literal('')),
          phone: z.string().trim().max(40).optional().or(z.literal('')),
        })
        .refine(c => !!(c.email || c.phone), { message: 'Add an email or a phone number', path: ['phone'] }),
      serviceId: uuid.optional(),
      customService: z
        .object({
          name: z.string().trim().min(1, 'Name the service').max(150),
          durationMins: z.number().int().min(5, 'At least 5 minutes').max(720, 'Up to 12 hours'),
        })
        .optional(),
      staffId: uuid,
      // Omitted = the staff member's only location, else the main one
      locationId: uuid.optional(),
      date: isoDate,
      time: HHMM,
      priceCents: cents,
      paymentArrangement: z.enum(['cash', 'card_in_person', 'bank_transfer', 'other']),
      notes: z.string().trim().max(500).optional(),
      allowOverlap: z.boolean().optional(),
      notifyCustomer: z.boolean().optional(),
    })
    .refine(b => !!b.serviceId !== !!b.customService, {
      message: 'Choose a service or describe a custom one',
      path: ['serviceId'],
    }),
});

export const businessRefundSchema = z.object({
  params: businessIdParams.extend({ bookingId: uuid }),
  body: z
    .object({
      // Omitted = everything still refundable
      amountCents: z.number().int().min(1).max(10_000_000).optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .optional()
    .default({}),
});

const rescheduleSlotsQuery = z.object({ date: isoDate, staffId: uuid.optional() });
const rescheduleBody = { date: isoDate, time: HHMM, staffId: uuid.optional() };

export const businessRescheduleSlotsSchema = z.object({
  params: businessIdParams.extend({ bookingId: uuid }),
  query: rescheduleSlotsQuery,
});

export const businessRescheduleSchema = z.object({
  params: businessIdParams.extend({ bookingId: uuid }),
  body: z.object({ ...rescheduleBody, message: z.string().trim().max(500).optional() }),
});

export const customerRescheduleSlotsSchema = z.object({
  params: z.object({ bookingId: uuid }),
  query: rescheduleSlotsQuery,
});

export const customerRescheduleSchema = z.object({
  params: z.object({ bookingId: uuid }),
  body: z.object(rescheduleBody),
});

// Reserve Now ($20/mo, Food & Dining): start checkout (optionally saving the link first) / confirm on return
export const reserveNowCheckoutSchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      platform: z.enum(['web', 'ios', 'android']).optional(),
      reservationUrl: reservationUrl.optional(),
    })
    .optional()
    .default({}),
});

// In-app card form: step 1 creates the unpaid subscription, step 2 verifies the first payment
export const reserveNowNativeIntentSchema = z.object({
  params: businessIdParams,
  body: z.object({ reservationUrl: reservationUrl.optional() }).optional().default({}),
});

export const reserveNowNativeFinalizeSchema = z.object({
  params: businessIdParams,
  body: z.object({
    subscriptionId: z.string().trim().regex(/^sub_[A-Za-z0-9]+$/, 'Invalid subscription'),
    paymentIntentId: z.string().trim().regex(/^pi_[A-Za-z0-9]+$/, 'Invalid payment'),
  }),
});

export const reserveNowConfirmSchema = z.object({
  params: businessIdParams,
  body: z.object({ sessionId: z.string().trim().regex(/^cs_[A-Za-z0-9_]+$/, 'Invalid checkout session') }),
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

// ─── Reviews ────────────────────────────────────────────────────────────────
const reviewListQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  // Only reviews of visits at this location
  locationId: uuid.optional(),
});

export const listPublicReviewsSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  query: reviewListQuery,
});

export const listBusinessReviewsSchema = z.object({
  params: businessIdParams,
  query: reviewListQuery,
});

const rating = z.number().int().min(1).max(5);

export const createReviewSchema = z.object({
  params: z.object({ bookingId: uuid }),
  body: z.object({ rating, comment: optionalText(2000) }),
});

export const updateReviewSchema = z.object({
  params: z.object({ bookingId: uuid }),
  body: z
    .object({ rating: rating.optional(), comment: optionalText(2000) })
    .refine(b => b.rating !== undefined || b.comment !== undefined, { message: 'Nothing to update' }),
});

// ─── Wall (standard business pages) ────────────────────────────────────────
export const listWallPostsSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  }),
});

/** Opens the conversation a customer's inquiry is sent in (inbox channel). */
export const inquiryConversationSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
});

export const createWallPostSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
  body: z.object({ text: z.string().trim().min(1).max(2000) }),
});

export const wallPostIdSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120), postId: uuid }),
});

export const moderateWallPostSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120), postId: uuid }),
  body: z.object({ status: z.enum(['approved', 'rejected']) }),
});

export const listWallCommentsSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120), postId: uuid }),
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  }),
});

const wallCommentBody = {
  text: z.string().trim().min(1).max(1000),
  // Users tagged with @username in the text (only kept if the @username is in it)
  mentionedUserIds: z.array(uuid).max(20).optional().default([]),
};

export const createWallCommentSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120), postId: uuid }),
  // parentId: reply to a comment (replying to a reply attaches to its top-level comment)
  body: z.object({ ...wallCommentBody, parentId: uuid.nullable().optional() }),
});

// ─── Gallery posts (likes / comments) ───────────────────────────────────────
const galleryPostParams = z.object({
  idOrSlug: z.string().trim().min(1).max(120),
  postKey: z.string().regex(/^[0-9a-f]{24}$/, 'Post not found'),
});

export const galleryEngagementSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120) }),
});

export const galleryPostSchema = z.object({ params: galleryPostParams });

export const listGalleryCommentsSchema = z.object({
  params: galleryPostParams,
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  }),
});

const galleryCommentBody = {
  text: z
    .string()
    .trim()
    .min(1, 'Write a comment first')
    .max(1000, 'Comments can be up to 1000 characters'),
  // Users tagged with @username in the text (only kept if the @username is in it)
  mentionedUserIds: z.array(uuid).max(20).optional().default([]),
};

export const createGalleryCommentSchema = z.object({
  params: galleryPostParams,
  // parentId: reply to a comment (replying to a reply attaches to its top-level comment)
  body: z.object({ ...galleryCommentBody, parentId: uuid.nullable().optional() }),
});

export const updateGalleryCommentSchema = z.object({
  params: galleryPostParams.extend({ commentId: uuid }),
  body: z.object(galleryCommentBody),
});

export const galleryCommentIdSchema = z.object({
  params: galleryPostParams.extend({ commentId: uuid }),
});

export const listGalleryRepliesSchema = z.object({
  params: galleryPostParams.extend({ commentId: uuid }),
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  }),
});

export const wallCommentIdSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120), postId: uuid, commentId: uuid }),
});

export const updateWallCommentSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120), postId: uuid, commentId: uuid }),
  body: z.object(wallCommentBody),
});

export const listWallRepliesSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(120), postId: uuid, commentId: uuid }),
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  }),
});

export const replyToReviewSchema = z.object({
  params: businessIdParams.extend({ reviewId: uuid }),
  // Empty / null removes the reply
  body: z.object({ reply: z.string().trim().max(1000).nullable() }),
});

// ─── Earnings & wallet ──────────────────────────────────────────────────────
export const businessEarningsSchema = z.object({
  params: businessIdParams,
  query: z
    .object({
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      // Only bookings at this location (payouts / wallet stay business-wide)
      locationId: uuid.optional(),
    })
    .refine(q => !q.from || !q.to || new Date(q.from) <= new Date(q.to), {
      message: '`from` must be on or before `to`',
    }),
});

export const businessPayoutHistorySchema = z.object({
  params: businessIdParams,
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
});

export const businessCashOutSchema = z.object({
  params: businessIdParams,
  body: z.object({ amountCents: z.number().int().min(100).max(100_000_000) }),
});

// ─── Custom price offers ────────────────────────────────────────────────────
export const createCustomOfferSchema = z.object({
  params: businessIdParams,
  body: z
    .object({
      // Who it's for: the customer's user id (the other side of the inquiry chat)
      customerId: uuid,
      conversationId: uuid.optional(),
      // An existing menu service…
      serviceId: uuid.optional(),
      // …or a new one (addToMenu = also save it to the menu as "Inquire for pricing")
      newService: z
        .object({
          name: z.string().trim().min(1, 'Name the service').max(150),
          categoryName: optionalText(100),
          addToMenu: z.boolean().optional(),
        })
        .optional(),
      description: optionalText(2000),
      priceCents: z
        .number()
        .int()
        .min(100, 'The price must be at least $1')
        .max(10_000_000, 'The price can be up to $100,000'),
      durationMins: z.number().int().min(5, 'At least 5 minutes').max(24 * 60, 'Up to 24 hours'),
      paymentModel: z.enum(PAYMENT_MODELS),
      depositCents: cents.nullable().optional(),
      locationId: uuid.nullable().optional(),
      staffId: uuid.nullable().optional(),
      note: optionalText(1000),
      expiresInDays: z.number().int().min(1).max(30).optional(),
    })
    .refine(b => !!b.serviceId !== !!b.newService, {
      message: 'Pick a service or create a new one',
      path: ['serviceId'],
    })
    .refine(b => b.depositCents == null || b.depositCents <= b.priceCents, {
      message: 'The deposit can’t be more than the price',
      path: ['depositCents'],
    }),
});

export const listCustomOffersSchema = z.object({
  params: businessIdParams,
  query: z.object({
    customerId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }),
});

export const businessCustomOfferSchema = z.object({
  params: businessIdParams.extend({ offerId: uuid }),
});

export const customOfferSchema = z.object({ params: z.object({ offerId: uuid }) });

// Customer side: custom prices businesses sent me (My Calendar → Requests)
export const myCustomOffersSchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'all']).optional().default('pending'),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }),
});
