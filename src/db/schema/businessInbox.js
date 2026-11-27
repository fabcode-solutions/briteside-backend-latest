/**
 * Business inbox — conversations between a customer and a BUSINESS (not its
 * owner's personal account). A business profile is a separate account, so
 * these threads never show in anyone's personal inbox on the business side:
 * the owner and the team members allowed to (permission 'inbox.manage') read
 * and answer them from the business dashboard, and replies go out as the
 * business. The customer sees the thread as a conversation with the business.
 *
 * Read state is a timestamp per side (several team members share the
 * business side): a message is unread for a side when it came from the other
 * side after that side's lastReadAt.
 *
 * Three inboxes (`kind`), each its own thread with the same person:
 *   inquiry — customers asking about the business / a menu service (Send
 *             inquiry, Inquire on a service)
 *   general — ordinary messages, like personal DMs: the business can start
 *             one with anyone, and customers via "Message" on the page
 *   paid    — the business's priority (paid) messages to a creator; the
 *             creator's reply releases the payment. The business only sends
 *             paid messages here, never free ones.
 * The `customer` columns are the other person whatever the kind.
 */
import { pgTable, uuid, varchar, text, jsonb, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users.js';
import { businesses, businessServices } from './businesses.js';

export const businessConversations = pgTable(
  'business_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'inquiry' | 'general' | 'paid' (see above)
    kind: varchar('kind', { length: 10 }).notNull().default('inquiry'),
    // Inquiries: the menu service the customer's latest inquiry was about (the list's tag)
    serviceId: uuid('service_id').references(() => businessServices.id, { onDelete: 'set null' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    customerLastReadAt: timestamp('customer_last_read_at', { withTimezone: true }),
    businessLastReadAt: timestamp('business_last_read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // One thread per person per business per inbox
    uniqueIndex('uq_business_conversations_business_customer_kind').on(
      table.businessId,
      table.customerId,
      table.kind
    ),
    index('idx_business_conversations_business_kind_last').on(table.businessId, table.kind, table.lastMessageAt),
    index('idx_business_conversations_customer_last').on(table.customerId, table.lastMessageAt),
    check('chk_business_conversations_kind', sql`${table.kind} IN ('inquiry', 'general', 'paid')`),
  ]
);

export const businessMessages = pgTable(
  'business_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => businessConversations.id, { onDelete: 'cascade' }),
    // 'customer' | 'business' — which account the message is from
    senderSide: varchar('sender_side', { length: 10 }).notNull(),
    // The person who wrote it (for the business side: the team member; shown
    // to the team only — the customer sees the business)
    senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    // 'text' | 'inquiry' | 'image' | 'video' | 'file'
    messageType: varchar('message_type', { length: 20 }).notNull().default('text'),
    // Text, or the media URL for image / video / file
    content: text('content'),
    // Whitelisted keys only (see utils/businessInbox.js)
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('idx_business_messages_conversation_created').on(table.conversationId, table.createdAt),
    check('chk_business_messages_sender_side', sql`${table.senderSide} IN ('customer', 'business')`),
    check(
      'chk_business_messages_type',
      sql`${table.messageType} IN ('text', 'inquiry', 'image', 'video', 'file')`
    ),
  ]
);

export const businessConversationsRelations = relations(businessConversations, ({ one, many }) => ({
  business: one(businesses, { fields: [businessConversations.businessId], references: [businesses.id] }),
  customer: one(users, { fields: [businessConversations.customerId], references: [users.id] }),
  service: one(businessServices, { fields: [businessConversations.serviceId], references: [businessServices.id] }),
  messages: many(businessMessages),
}));

export const businessMessagesRelations = relations(businessMessages, ({ one }) => ({
  conversation: one(businessConversations, {
    fields: [businessMessages.conversationId],
    references: [businessConversations.id],
  }),
  senderUser: one(users, { fields: [businessMessages.senderUserId], references: [users.id] }),
}));
