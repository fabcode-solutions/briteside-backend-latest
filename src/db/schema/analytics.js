import { pgTable, uuid, date, integer, decimal, timestamp, unique } from 'drizzle-orm/pg-core';
import { events } from './events.js';

export const eventAnalytics = pgTable(
  'event_analytics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    pageViews: integer('page_views').default(0),
    uniqueVisitors: integer('unique_visitors').default(0),
    ticketsSold: integer('tickets_sold').default(0),
    revenue: decimal('revenue', { precision: 10, scale: 2 }).default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [unique().on(table.eventId, table.date)]
);
