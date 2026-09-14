import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../src/db/index.js';
import { organizers, users } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

async function getSeederUser() {
  const seederEmail = 'seeder@dev.local';

  let user = await db.query.users.findFirst({
    where: eq(users.email, seederEmail),
  });

  if (!user) {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const [createdUser] = await db
      .insert(users)
      .values({
        firebaseUid: 'seed_firebase_uid',
        username: 'seed_user',
        email: seederEmail,
        passwordHash,
        firstName: 'Seed',
        lastName: 'Organizer',
        phoneNumber: '0000000000',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    user = createdUser;
  }

  return user;
}

async function seedOrganizer() {
  console.log('Seeding organizer...');

  const existing = await db.query.organizers.findMany({ limit: 1 });
  if (existing.length > 0) {
    console.log('Organizer(s) already exist, skipping organizer seed');
    return existing[0];
  }

  const user = await getSeederUser();

  // Check for organizer for this user
  let organizer = await db.query.organizers.findFirst({
    where: eq(organizers.userId, user.id),
  });

  if (!organizer) {
    const organizerCode = `SEED_ORG_${Date.now().toString(36)}`;

    const [createdOrganizer] = await db
      .insert(organizers)
      .values({
        organizerCode,
        userId: user.id,
        businessName: 'Seed Organizer',
        businessDescription: 'Organizer created by seed script',
        contactEmail: user.email,
        contactPhone: user.phoneNumber,
        isVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    organizer = createdOrganizer;
    console.log('Seed organizer created:', organizer.businessName);
  } else {
    console.log('Seed organizer already present for user, using existing organizer');
  }

  return organizer;
}

async function main() {
  try {
    await seedOrganizer();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding organizer:', error);
    process.exit(1);
  }
}

export { seedOrganizer };

// Run directly when invoked as a script
if (process.argv[1] === __filename) {
  main();
}
