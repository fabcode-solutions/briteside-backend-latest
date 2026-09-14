import 'dotenv/config';
import { db } from '../src/db/index.js';
import { interestCategories } from '../src/db/schema/social.js';

const defaultInterests = [
  {
    name: 'Music',
    slug: 'music',
    description: 'All things music - concerts, festivals, artists, and genres',
    icon: '🎵',
    color: '#8B5CF6',
    sortOrder: 1,
  },
  {
    name: 'Technology',
    slug: 'technology',
    description: 'Tech trends, gadgets, programming, and innovation',
    icon: '💻',
    color: '#3B82F6',
    sortOrder: 2,
  },
  {
    name: 'Food & Drinking',
    slug: 'food-drinking',
    description: 'Culinary experiences, restaurants, recipes, and beverages',
    icon: '🍽️',
    color: '#F59E0B',
    sortOrder: 3,
  },
  {
    name: 'Art & Culture',
    slug: 'art-culture',
    description: 'Visual arts, museums, cultural events, and creative expression',
    icon: '🎨',
    color: '#EC4899',
    sortOrder: 4,
  },
  {
    name: 'Travel',
    slug: 'travel',
    description: 'Adventures, destinations, travel tips, and exploration',
    icon: '✈️',
    color: '#10B981',
    sortOrder: 5,
  },
  {
    name: 'Fashion',
    slug: 'fashion',
    description: 'Style trends, fashion shows, brands, and personal style',
    icon: '👗',
    color: '#F97316',
    sortOrder: 6,
  },
  {
    name: 'Gaming',
    slug: 'gaming',
    description: 'Video games, esports, gaming culture, and entertainment',
    icon: '🎮',
    color: '#6366F1',
    sortOrder: 7,
  },
  {
    name: 'Fitness',
    slug: 'fitness',
    description: 'Health, wellness, workouts, and active lifestyle',
    icon: '💪',
    color: '#EF4444',
    sortOrder: 8,
  },
  {
    name: 'Business',
    slug: 'business',
    description: 'Entrepreneurship, networking, professional development',
    icon: '💼',
    color: '#374151',
    sortOrder: 9,
  },
  {
    name: 'YouTube',
    slug: 'youtube',
    description: 'YouTube videos, creators, and channels',
    icon: '📺',
    color: '#FF0000',
    sortOrder: 10,
  },
];

async function seedInterests() {
  try {
    console.log('Seeding interest categories...');

    for (const interest of defaultInterests) {
      await db
        .insert(interestCategories)
        .values({ ...interest, isDefault: true })
        .onConflictDoUpdate({
          target: interestCategories.slug,
          set: { isDefault: true },
        });
    }

    console.log('Interest categories seeded successfully!');
  } catch (error) {
    console.error('Error seeding interests:', error);
    throw error;
  }
}

async function main() {
  try {
    await seedInterests();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding interests:', error);
    process.exit(1);
  }
}

main();
