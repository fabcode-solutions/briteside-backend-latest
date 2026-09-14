import 'dotenv/config';
import { db } from '../src/db/index.js';
import { categories } from '../src/db/schema/index.js';
import { seedGroupCategories } from './seed-all.js';

const defaultCategories = [
  {
    name: 'Music',
    description: 'Concerts, festivals, and musical performances',
  },
  {
    name: 'Sports',
    description: 'Athletic events, tournaments, and sports activities',
  },
  {
    name: 'Business',
    description: 'Conferences, networking events, and professional meetups',
  },
  {
    name: 'Technology',
    description: 'Tech conferences, workshops, and innovation events',
  },
  {
    name: 'Food & Drink',
    description: 'Culinary events, tastings, and food festivals',
  },
  {
    name: 'Arts & Culture',
    description: 'Art exhibitions, cultural events, and creative workshops',
  },
  {
    name: 'Health & Wellness',
    description: 'Fitness events, wellness workshops, and health seminars',
  },
  {
    name: 'Education',
    description: 'Educational workshops, seminars, and learning events',
  },
];

async function seedCategories() {
  console.log('Seeding categories...');

  // Check if categories already exist
  const existingCategories = await db.query.categories.findMany();

  if (existingCategories.length > 0) {
    console.log('Categories already exist, skipping seed');
    return;
  }

  // Insert default categories
  const categoriesWithTimestamps = defaultCategories.map(category => ({
    ...category,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  await db.insert(categories).values(categoriesWithTimestamps);

  console.log('Categories seeded successfully');
}

async function main() {
  try {
    await seedCategories();
    await seedGroupCategories(); // Call the group categories seeding function
    process.exit(0);
  } catch (error) {
    console.error('Error seeding categories:', error);
    process.exit(1);
  }
}

main();
