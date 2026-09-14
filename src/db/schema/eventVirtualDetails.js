import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { events } from './events.js';

// Enum for virtual platform types
export const virtualPlatformEnum = pgEnum('virtual_platform_enum', [
  'briteside',
  'zoom',
  'google_meet',
  'microsoft_teams',
  'webex',
  'skype',
  'discord',
  'twitch',
  'youtube_live',
  'facebook_live',
  'other',
]);

// Enum for platform names (more specific platform identification)
export const platformNameEnum = pgEnum('platform_name_enum', [
  'briteside',
  'zoom',
  'google_meet',
  'microsoft_teams',
  'webex',
  'skype',
  'discord',
  'twitch',
  'youtube_live',
  'facebook_live',
  'other',
]);

// Table to store virtual event details based on platform
export const eventVirtualDetails = pgTable(
  'event_virtual_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' })
      .unique(), // One virtual detail per event
    virtualPlatform: virtualPlatformEnum('virtual_platform').notNull(),

    // For non-briteside platforms (zoom, other) - external meeting link
    meetingLink: text('meeting_link'),

    // For briteside platform - additional details
    duration: integer('duration'), // Duration in minutes
    maxAttendees: integer('max_attendees'), // Number of attendees allowed
    briteVideoLink: text('brite_video_link'), // Briteside video link (auto-generated or provided)

    // Common metadata
    platformName: platformNameEnum('platform_name'), // Specific platform identification
    accessInstructions: text('access_instructions'), // Optional instructions for joining
    password: varchar('password', { length: 100 }), // Meeting password if any

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    index('idx_event_virtual_details_event').on(table.eventId),
    index('idx_event_virtual_details_platform').on(table.virtualPlatform),
  ]
);
