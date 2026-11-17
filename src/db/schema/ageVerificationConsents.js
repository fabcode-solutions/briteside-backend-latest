import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

import { users } from './users.js';

// Audit trail of the consent clickwrap shown right before each Didit
// verification step. One row per acceptance; the exact wording is kept so
// the record stays meaningful after the copy changes.
export const ageVerificationConsents = pgTable(
  'age_verification_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'estimate' (selfie age estimation) | 'id' (ID document + selfie)
    kind: varchar('kind', { length: 20 }).notNull(),
    textVersion: varchar('text_version', { length: 20 }).notNull(),
    consentText: text('consent_text').notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [index('idx_age_verification_consents_user').on(table.userId, table.createdAt)]
);
