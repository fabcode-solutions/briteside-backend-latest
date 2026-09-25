import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  text,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { talentProfiles } from './talentProfiles.js';
import { socialConversations, socialMessages } from './socialChat.js';

// ─── Payments: billing only, no message content ───────────────────────────
//
// Stripe checkout / payment lifecycle for a priority message (or batch of
// priority messages). Content lives in `social_messages`; this table only
// tracks money + status. A single checkout can cover 1-10 messages — each
// one gets its own row in `priority_message_items`.
//
// status values:
//   pending   — checkout created, payment not yet confirmed
//   paid      — payment confirmed, message(s) delivered, AWAITING TALENT REPLY
//               → this is what drives "Awaiting reply" in the sidebar + the
//                 "Reply to release $X" banner
//   replied   — talent replied, payment released, counts toward "Total earned"
//   refunded  — talent never replied within the window, sender refunded
//   failed    — webhook delivery failed after payment succeeded

export const priorityMessagePayments = pgTable(
  'priority_message_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    talentProfileId: uuid('talent_profile_id')
      .notNull()
      .references(() => talentProfiles.id, { onDelete: 'cascade' }),
    talentUserId: uuid('talent_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    conversationId: uuid('conversation_id').references(() => socialConversations.id, {
      onDelete: 'set null',
    }),

    messageCount: integer('message_count').notNull().default(1),

    amountCents: integer('amount_cents').notNull(),
    baseCents: integer('base_cents'),

    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // pending | paid | replied | refunded | failed

    stripeSessionId: varchar('stripe_session_id', { length: 255 }),
    stripePaymentIntent: varchar('stripe_payment_intent', { length: 255 }),
    // Set once Stripe actually creates the Connect transfer for this charge —
    // null means the talent's cut is still sitting in the platform balance
    // (e.g. talent's connect account wasn't chargesEnabled yet at charge time).
    transferId: varchar('transfer_id', { length: 255 }),
    transferredAt: timestamp('transferred_at', { withTimezone: true }),

    paidAt: timestamp('paid_at', { withTimezone: true }), // payment confirmed + delivered
    repliedAt: timestamp('replied_at', { withTimezone: true }), // talent's reply released the payment
    refundedAt: timestamp('refunded_at', { withTimezone: true }),

    // SLA escrow — the talent's cut isn't transferred at checkout; it's held
    // on the platform's own Stripe balance and moved to the talent's Connect
    // account by a scheduled job 48h after repliedAt.
    reserveAmountCents: integer('reserve_amount_cents').default(0),
    reserveReleasedAt: timestamp('reserve_released_at', { withTimezone: true }),

    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  table => [
    index('idx_pmp_sender').on(table.senderId),
    index('idx_pmp_talent_user').on(table.talentUserId),
    index('idx_pmp_status').on(table.status),
    index('idx_pmp_conversation').on(table.conversationId),
    index('idx_pmp_paid_at').on(table.paidAt),
    // Sidebar/banner both filter "talent's payments still awaiting reply" —
    // composite index makes that lookup cheap.
    index('idx_pmp_talent_status').on(table.talentUserId, table.status),
    index('idx_pmp_conversation_status').on(table.conversationId, table.status),
  ]
);

// ─── Items: junction table, one row per message in a checkout ─────────────
//
// Drafted at checkout time (content held here temporarily, pre-payment),
// then linked to the real `social_messages` row once webhook delivery
// succeeds. `position` preserves send order for multi-message checkouts.

export const priorityMessageItems = pgTable(
  'priority_message_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => priorityMessagePayments.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    repliedAt: timestamp('replied_at', { withTimezone: true }),

    replyMessageId: uuid('reply_message_id').references(() => socialMessages.id, {
      onDelete: 'set null',
    }),

    subject: varchar('subject', { length: 255 }),
    messageContent: text('message_content').notNull(),
    // Optional extended content — each 280-char block costs one extra message fee
    contentExtended: text('content_extended'),

    messageId: uuid('message_id').references(() => socialMessages.id, { onDelete: 'set null' }),

    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    // Item-level status: pending | replied | expired
    // ('expired' = the 72h reply window closed with no on-time reply; a
    // late reply after that still increments replyCount but never earns.)
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // How many times talent has replied to this specific item
    replyCount: integer('reply_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_pmi_payment').on(table.paymentId),
    index('idx_pmi_message').on(table.messageId),
    index('idx_pmi_payment_position').on(table.paymentId, table.position),
    index('idx_pmi_replied_at').on(table.repliedAt),
    index('idx_pmi_reply_message').on(table.replyMessageId),
    index('idx_pmi_status').on(table.status),
    check('chk_content_extended_length', sql`char_length(content_extended) <= 1400`),
  ]
);
