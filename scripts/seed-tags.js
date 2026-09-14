import 'dotenv/config';
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

  const values = popularTags.map(name => ({
    name: name.trim().toLowerCase(), // normalize once
  }));

  await db.insert(tags).values(values).onConflictDoNothing({ target: tags.name });

  console.log('✅ Tags seeded successfully!');
  process.exit(0);
}

seedTags().catch(err => {
  console.error('❌ Error seeding tags:', err);
  process.exit(1);
});
