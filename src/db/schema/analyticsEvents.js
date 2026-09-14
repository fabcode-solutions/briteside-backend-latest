import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Generic, append-only event log for cross-module analytics (impression, view,
// click, comment, like, share, and any future custom event name — no enum,
// no migration needed to add new event names). Range-partitioned by month on
// `occurredAt`; see manual-migrations/add_analytics_events_partitioned.sql.
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').defaultRandom().notNull(),
    eventName: varchar('event_name', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    entityId: uuid('entity_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    anonymousId: varchar('anonymous_id', { length: 64 }),
    sessionId: varchar('session_id', { length: 64 }),
    clientEventId: uuid('client_event_id').notNull(),
    properties: jsonb('properties').notNull().default({}),
    context: jsonb('context'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // Partitioned tables can't carry a plain PK/unique constraint that omits the
    // partition key, so `occurredAt` is folded into these instead of a bare `id` PK
    // / bare-`clientEventId` unique — see the partition migration for the DDL.
    uniqueIndex('idx_analytics_events_client_event').on(table.clientEventId, table.occurredAt),
    index('idx_analytics_events_entity_timeline').on(
      table.entityType,
      table.entityId,
      table.occurredAt
    ),
    index('idx_analytics_events_entity_funnel').on(
      table.entityType,
      table.entityId,
      table.eventName,
      table.occurredAt
    ),
    index('idx_analytics_events_user').on(table.userId, table.occurredAt),
    index('idx_analytics_events_anonymous').on(table.anonymousId, table.occurredAt),
    index('idx_analytics_events_session').on(table.sessionId),
  ]
);
