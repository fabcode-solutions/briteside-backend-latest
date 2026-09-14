import { pgTable, uuid, integer, text, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { priorityMessagePayments, priorityMessageItems } from './priorityMessagePayments.js';
import { media } from './fileTracking.js';
import { users } from './users.js';

// status: pending  = uploaded, talent hasn't opened it yet
//         viewed   = talent clicked/downloaded the file
//         refunded = 48h expired without view, 99¢ refunded
export const priorityMessageAttachments = pgTable(
  'priority_message_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    paymentId: uuid('payment_id')
      .notNull()
      .references(() => priorityMessagePayments.id, { onDelete: 'cascade' }),

    itemId: uuid('item_id').references(() => priorityMessageItems.id, {
      onDelete: 'set null',
    }),

    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id),

    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),

    url: text('url').notNull(),
    s3Key: text('s3_key').notNull(),
    originalName: varchar('original_name', { length: 255 }),
    mimetype: varchar('mimetype', { length: 100 }),
    sizeBytes: integer('size_bytes'),

    priceCents: integer('price_cents').notNull().default(99),

    // pending | viewed | refunded
    status: varchar('status', { length: 20 }).notNull().default('pending'),

    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_pma_payment').on(table.paymentId),
    index('idx_pma_item').on(table.itemId),
    index('idx_pma_status').on(table.status),
    index('idx_pma_payment_status').on(table.paymentId, table.status),
  ]
);

export const priorityMessageAttachmentsRelations = relations(
  priorityMessageAttachments,
  ({ one }) => ({
    payment: one(priorityMessagePayments, {
      fields: [priorityMessageAttachments.paymentId],
      references: [priorityMessagePayments.id],
    }),
    item: one(priorityMessageItems, {
      fields: [priorityMessageAttachments.itemId],
      references: [priorityMessageItems.id],
    }),
    media: one(media, {
      fields: [priorityMessageAttachments.mediaId],
      references: [media.id],
    }),
    uploader: one(users, {
      fields: [priorityMessageAttachments.uploadedBy],
      references: [users.id],
    }),
  })
);
