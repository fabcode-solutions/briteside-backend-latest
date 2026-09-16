import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  decimal,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { talentProfiles } from './talentProfiles.js';

/**
 * talent_sessions
 *
 * One row per booked 1:1 session.
 *
 * Status lifecycle:
 *   pending → confirmed → live → completed
 *                      ↘ cancelled
 *                      ↘ declined
 *                      ↘ rescheduled (creates new session, this one cancelled)
 *
 * Billing lifecycle:
 *   Clock does NOT start when the call room opens.
 *   booker_joined_at  — set the moment the booker joins the Stream call
 *   talent_joined_at  — set the moment the talent joins the Stream call
 *   billing_started_at — set automatically when BOTH are non-null
 *   billing_ended_at   — set when call ends (either side leaves OR auto-end job fires)
 *   actual_duration_mins — computed from billing_started_at → billing_ended_at
 *
 * Join window:
 *   join_allowed_at = scheduledAt − 5 minutes
 *   Enforced in the call room page — no one may enter the Stream room before this time.
 *
 * No-show grace:
 *   If talent has not joined within 10 minutes of scheduledAt, the system
 *   auto-cancels and issues a full refund.
 */
export const talentSessions = pgTable(
  'talent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Parties
    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),
    bookerId: uuid('booker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Scheduling
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    durationMins: integer('duration_mins').notNull(), // 15 | 30 | 45 | 60

    // Join & billing timestamps
    joinAllowedAt: timestamp('join_allowed_at', { withTimezone: true }).notNull(), // scheduledAt - 5min
    bookerJoinedAt: timestamp('booker_joined_at', { withTimezone: true }),
    talentJoinedAt: timestamp('talent_joined_at', { withTimezone: true }),
    billingStartedAt: timestamp('billing_started_at', { withTimezone: true }),
    billingEndedAt: timestamp('billing_ended_at', { withTimezone: true }),
    actualDurationMins: integer('actual_duration_mins'), // filled on session end

    // Pricing — locked at booking time, not recalculated later
    priceCents: integer('price_cents').notNull(), // e.g. 15000 = $150.00

    // Status
    status: varchar('status', { length: 30 }).notNull().default('pending'),
    // pending | confirmed | live | completed | cancelled | declined | rescheduled

    // Booking details
    subject: varchar('subject', { length: 255 }).notNull(),
    discussion: text('discussion'),

    // Gift booking
    isGift: boolean('is_gift').notNull().default(false),
    giftDetails: jsonb('gift_details').default(sql`'{}'::jsonb`),
    // { recipientName, recipientEmail, recipientPhone, occasion, deliveryDate, message }
    giftCode: varchar('gift_code', { length: 50 }), // code used to redeem a gifted session

    // Stream call reference
    streamCallCid: varchar('stream_call_cid', { length: 255 }),
    // cid of the stream_calls record (e.g. "default:uuid")

    // Call moderation — frame-recording verdicts on the live call.
    // approved | flagged | rejected | shadowed (worst tier reached so far)
    moderationStatus: varchar('moderation_status', { length: 16 }).notNull().default('approved'),
    // Append-only audit log: [{ trackType, action, label, participantId, capturedAt }]
    moderationEventsLog: jsonb('moderation_events_log').default(sql`'[]'::jsonb`),

    // Random report-screenshot sampling — offsets (seconds since the call's
    // first captured frame) picked once per session, independent of any
    // moderation verdict. Computed lazily in applyFrameVerdict() on the first
    // frame (call start isn't known before then).
    // [{ offsetSeconds, consumed: boolean }]
    reportScreenshotTargets: jsonb('report_screenshot_targets').default(sql`'[]'::jsonb`),

    // Recording consent/disclosure — stamped independently by each party via
    // POST /api/talent-sessions/:id/acknowledge-recording before they can
    // obtain a call-join token.
    bookerRecordingConsentAt: timestamp('booker_recording_consent_at', { withTimezone: true }),
    talentRecordingConsentAt: timestamp('talent_recording_consent_at', { withTimezone: true }),
    recordingDisclosureVersion: varchar('recording_disclosure_version', { length: 32 }),

    // Stripe payment references
    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    // Set once Stripe actually creates the Connect transfer for this charge —
    // null means the talent's cut is still sitting in the platform balance
    // (e.g. talent's connect account wasn't chargesEnabled yet at charge time).
    transferId: varchar('transfer_id', { length: 255 }),
    transferredAt: timestamp('transferred_at', { withTimezone: true }),

    // Reminders sent flags — prevents duplicate sends
    reminder24hSentAt: timestamp('reminder_24h_sent_at', { withTimezone: true }),
    reminder1hSentAt: timestamp('reminder_1h_sent_at', { withTimezone: true }),
    reminder15mSentAt: timestamp('reminder_15m_sent_at', { withTimezone: true }),
    reminder10mSentAt: timestamp('reminder_10m_sent_at', { withTimezone: true }),
    reminder1mSentAt: timestamp('reminder_1m_sent_at', { withTimezone: true }),
    reviewReminderSentAt: timestamp('review_reminder_sent_at', { withTimezone: true }),

    // Cancellation / rescheduling
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancellationReason: text('cancellation_reason'),
    refundIssuedAt: timestamp('refund_issued_at', { withTimezone: true }),

    // If this session replaced an earlier one via reschedule
    rescheduledFromId: uuid('rescheduled_from_id'),

    reserveAmountCents: integer('reserve_amount_cents').default(0),
    reserveReleasedAt: timestamp('reserve_released_at', { withTimezone: true }),
    platformShareCents: integer('platform_share_cents').default(0),
    stripeFeeCents: integer('stripe_fee_cents').default(0),

    // Call quality feedback — submitted by each party after session ends
    bookerCallRating: integer('booker_call_rating'), // 1–5
    bookerCallFeedback: text('booker_call_feedback'),
    talentCallRating: integer('talent_call_rating'), // 1–5
    talentCallFeedback: text('talent_call_feedback'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_talent_sessions_talent').on(table.talentProfileId),
    index('idx_talent_sessions_booker').on(table.bookerId),
    index('idx_talent_sessions_status').on(table.status),
    index('idx_talent_sessions_scheduled').on(table.scheduledAt),
    index('idx_talent_sessions_stream_cid').on(table.streamCallCid),
    index('idx_talent_sessions_reminder_24h').on(table.reminder24hSentAt),
    index('idx_talent_sessions_reminder_1h').on(table.reminder1hSentAt),
    index('idx_talent_sessions_reminder_10m').on(table.reminder10mSentAt),
    index('idx_talent_sessions_reminder_1m').on(table.reminder1mSentAt),
  ]
);
