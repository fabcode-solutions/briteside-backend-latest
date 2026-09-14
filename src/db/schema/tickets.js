import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  integer,
  boolean,
  timestamp,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events.js';

export const eventTickets = pgTable(
  'event_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketCode: varchar('ticket_code', { length: 50 }).notNull().unique(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    price: decimal('price', { precision: 10, scale: 2 }).notNull().default('0'),
    doorSalePrice: decimal('door_sale_price', { precision: 10, scale: 2 }),
    quantityAvailable: integer('quantity_available').notNull().default(0),
    quantitySold: integer('quantity_sold').notNull().default(0),
    salesStart: timestamp('sales_start', { withTimezone: true }).notNull(),
    salesEnd: timestamp('sales_end', { withTimezone: true }).notNull(),
    minTicketsPerOrder: integer('min_tickets_per_order').default(1),
    maxTicketsPerOrder: integer('max_tickets_per_order'),
    groupDealSize: integer('group_deal_size'),
    qrCodeSecret: varchar('qr_code_secret', { length: 255 }),
    qrCodeUrl: text('qr_code_url'),
    saleDiscountPercent: decimal('sale_discount_percent', { precision: 5, scale: 2 }),
    saleStartDate: timestamp('sale_start_date', { withTimezone: true }),
    saleEndDate: timestamp('sale_end_date', { withTimezone: true }),
    isSaleActive: boolean('is_sale_active').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    check('sales_end_check', sql`${table.salesEnd} > ${table.salesStart}`),
    check('price_check', sql`${table.price} >= 0`),
    check('quantity_check', sql`${table.quantityAvailable} >= 0`),
    check('min_tickets_check', sql`${table.minTicketsPerOrder} >= 1`),
    check(
      'max_tickets_check',
      sql`${table.maxTicketsPerOrder} IS NULL OR ${table.maxTicketsPerOrder} >= ${table.minTicketsPerOrder}`
    ),
    check(
      'group_deal_size_check',
      sql`${table.groupDealSize} IS NULL OR ${table.groupDealSize} >= 2`
    ),
    check(
      'sale_discount_check',
      sql`${table.saleDiscountPercent} IS NULL OR (${table.saleDiscountPercent} > 0 AND ${table.saleDiscountPercent} <= 60)`
    ),
    index('idx_event_tickets_event').on(table.eventId),
    index('idx_event_tickets_sales').on(table.salesStart, table.salesEnd),
  ]
);

export const eventMerchandise = pgTable(
  'event_merchandise',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    quantityAvailable: integer('quantity_available').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    check('price_check', sql`${table.price} >= 0`),
    check('quantity_check', sql`${table.quantityAvailable} >= 0`),
  ]
);
