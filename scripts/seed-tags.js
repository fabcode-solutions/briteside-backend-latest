import 'dotenv/config';
import { sql, inArray } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { tags } from '../src/db/schema/groupEnhancements.js';

const popularTags = [
  'Networking',
  'Programming',
  'Startups',
  'AI & Data Science',
  'Learning',
  'Coffee & Conversation',
  'Nightlife',
  'Socializing',
  'Dating',
  'Book Club',
  'Jazz Music',
  'Live Concerts',
  'Photography',
  'Art Gallery',
  'Electronic Music',
  'Fitness',
  'Yoga',
  'Running',
  'Hiking',
  'Mental Health',
  'Adventure Travel',
  'Outdoor Exploration',
  'Weekend Getaways',
  'Sightseeing',
  'Gaming',
  'Board Games',
  'Cooking',
  'Wine Tasting',
  'Creative Writing',
  'Sustainability',
];

async function seedTags() {
  console.log('🌱 Starting tag seeding...');

  const names = [...new Set(popularTags.map(name => name.trim().toLowerCase()))];

  // Best-effort: restore the unique index declared in the schema (uq_tags_name) if the DB is missing it.
  try {
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_name ON tags (name)`);
  } catch (err) {
    console.warn('⚠️  Could not ensure uq_tags_name index (duplicate tag names?):', err.message);
  }

  // Insert only missing names so we never depend on ON CONFLICT inference.
  const existing = await db.select({ name: tags.name }).from(tags).where(inArray(tags.name, names));
  const existingNames = new Set(existing.map(row => row.name));
  const values = names.filter(name => !existingNames.has(name)).map(name => ({ name }));

  if (values.length > 0) {
    await db.insert(tags).values(values);
  }
  console.log(`   inserted ${values.length}, already present ${existingNames.size}`);

  console.log('✅ Tags seeded successfully!');
  process.exit(0);
}

seedTags().catch(err => {
  console.error('❌ Error seeding tags:', err);
  process.exit(1);
});
