import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

export const contentReports = pgTable(
  'content_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentType: varchar('content_type', { length: 50 }).notNull(),
    contentId: uuid('content_id').notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    actionTaken: varchar('action_taken', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_content_reports_status')
      .on(table.status)
      .where(sql`${table.status} = 'pending'`),
  ]
);

export const adminTasks = pgTable(
  'admin_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    priority: varchar('priority', { length: 20 }).default('medium'),
    status: varchar('status', { length: 20 }).default('todo'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [index('idx_admin_tasks_status').on(table.status)]
);

export const taskSubtasks = pgTable('task_subtasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => adminTasks.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  isCompleted: boolean('is_completed').default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: varchar('action', { length: 50 }).notNull(),
    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: uuid('resource_id'),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    userIp: varchar('user_ip', { length: 45 }),
    userAgent: text('user_agent'),
    previousValues: jsonb('previous_values'),
    newValues: jsonb('new_values'),
    changes: jsonb('changes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
    index('idx_audit_logs_user').on(table.userId),
    index('idx_audit_logs_created').on(table.createdAt),
  ]
);

export const adminReports = pgTable('admin_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportType: varchar('report_type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  parameters: jsonb('parameters'),
  data: jsonb('data'),
  generatedBy: uuid('generated_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

export const systemSettings = pgTable('system_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  settingKey: varchar('setting_key', { length: 100 }).notNull().unique(),
  settingValue: jsonb('setting_value').notNull(),
  description: text('description'),
  isPublic: boolean('is_public').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
