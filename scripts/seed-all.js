import 'dotenv/config';
import { db } from '../src/db/index.js';
import { roles, categories, groupCategories } from '../src/db/schema/index.js';
import { interestCategories } from '../src/db/schema/social.js';
import { seedUsers } from './seed-users.js';
import { seedVenues } from './seed-venues.js';
import { seedOrganizer } from './seed-organizer.js';
import { seedEvents } from './seed-events.js';
import { eq } from 'drizzle-orm';

const defaultCategories = [
  {
    name: 'Music',
    description: 'Concerts, festivals, and musical performances',
    iconUrl: 'https://dummyimage.com/300/000/fff.png&text=Music',
    emoji: '🎵',
  },
  {
    name: 'Sports',
    description: 'Athletic events, tournaments, and sports activities',
    iconUrl: 'https://dummyimage.com/300/000/fff.png&text=Sports',
    emoji: '⚽',
  },
  {
    name: 'Business',
    description: 'Conferences, networking events, and professional meetups',
    iconUrl: 'https://dummyimage.com/300/000/fff.png&text=Business',
    emoji: '💼',
  },
  {
    name: 'Technology',
    description: 'Tech conferences, workshops, and innovation events',
    iconUrl: 'https://dummyimage.com/300/000/fff.png&text=Technology',
    emoji: '💻',
  },
  {
    name: 'Food & Drink',
    description: 'Culinary events, tastings, and food festivals',
    iconUrl: 'https://dummyimage.com/300/000/fff.png&text=Food',
    emoji: '🍔',
  },
  {
    name: 'Arts & Culture',
    description: 'Art exhibitions, cultural events, and creative workshops',
    iconUrl: 'https://dummyimage.com/300/000/fff.png&text=Arts',
    emoji: '🎨',
  },
  {
    name: 'Health & Wellness',
    description: 'Fitness events, wellness workshops, and health seminars',
    iconUrl: 'https://dummyimage.com/300/000/fff.png&text=Health',
    emoji: '🧘',
  },
  {
    name: 'Education',
    description: 'Educational workshops, seminars, and learning events',
    iconUrl: 'https://dummyimage.com/300/000/fff.png&text=Education',
    emoji: '📚',
  },
];

const defaultGroupCategories = [
  {
    name: 'All',
    description: 'Browse all groups across every category',
    emoji: '✨',
  },
  {
    name: 'Technology',
    description: 'Tech conferences, workshops, and innovation events',
    emoji: '💻',
  },
  {
    name: 'Fitness',
    description: 'Athletic events, tournaments, and fitness activities',
    emoji: '💪',
  },
  {
    name: 'Photography',
    description: 'Photography walks, workshops, and creative meetups',
    emoji: '📸',
  },
  {
    name: 'Music',
    description: 'Concerts, festivals, and musical performances',
    emoji: '🎵',
  },
  {
    name: 'Literature',
    description: 'Book clubs, readings, and literary discussions',
    emoji: '📚',
  },
  {
    name: 'Travel',
    description: 'Travel meetups, experiences, and group adventures',
    emoji: '✈️',
  },
  {
    name: 'Gaming',
    description: 'Gaming tournaments, LAN parties, and esports events',
    emoji: '🎮',
  },
  {
    name: 'Food',
    description: 'Food tastings, culinary meetups, and dining experiences',
    emoji: '🍔',
  },
  {
    name: 'Education',
    description: 'Educational workshops, seminars, and learning events',
    emoji: '🎓',
  },
];

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
];

async function seedRoles() {
  console.log('Seeding roles...');

  const authenticatedRole = await db.query.roles.findFirst({
    where: eq(roles.name, 'authenticated'),
  });

  if (!authenticatedRole) {
    console.log("Creating 'authenticated' role...");
    await db.insert(roles).values({
      name: 'authenticated',
      description: 'Default role for all authenticated users.',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log("'authenticated' role created.");
  } else {
    console.log("'authenticated' role already exists.");
  }
}

async function seedCategories() {
  console.log('Seeding categories...');

  const existingCategories = await db.query.categories.findMany();

  if (existingCategories.length > 0) {
    console.log('Categories already exist, skipping seed');
    return;
  }

  const categoriesWithTimestamps = defaultCategories.map(category => ({
    ...category,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  await db.insert(categories).values(categoriesWithTimestamps);
  console.log('Categories seeded successfully');
}

export async function seedGroupCategories() {
  const existingGroupCategories = await db.query.groupCategories.findMany();
  console.log('Seeding Group categories...', existingGroupCategories);

  if (existingGroupCategories.length > 0) {
    console.log('Categories already exist, skipping seed');
    return;
  }
  console.log('Categories here are being seeded...');

  const groupCategoriesWithTimestamps = defaultGroupCategories.map(category => ({
    ...category,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  await db.insert(groupCategories).values(groupCategoriesWithTimestamps);
  console.log('Categories seeded successfully');
}

async function seedInterests() {
  try {
    console.log('Seeding interest categories...');

    for (const interest of defaultInterests) {
      await db.insert(interestCategories).values(interest).onConflictDoNothing();
    }

    console.log('Interest categories seeded successfully!');
  } catch (error) {
    console.error('Error seeding interests:', error);
    throw error;
  }
}

async function main() {
  try {
    console.log('Starting database seeding...');

    await seedUsers();
    await seedRoles();
    await seedCategories();
    await seedGroupCategories();
    await seedInterests();
    await seedVenues();
    await seedOrganizer();
    await seedEvents();

    console.log('All seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  }
}

main();
