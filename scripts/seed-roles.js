import 'dotenv/config';
import { db } from '../src/db/index.js';
import { roles } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';

const DEFAULT_ROLES = [
  { name: 'authenticated', description: 'Default role for all authenticated users.' },
  { name: 'admin', description: 'Administrator with full platform access.' },
];

async function seedRoles() {
  console.log('Seeding roles...');

  for (const role of DEFAULT_ROLES) {
    const existing = await db.query.roles.findFirst({
      where: eq(roles.name, role.name),
    });

    if (!existing) {
      console.log(`Creating '${role.name}' role...`);
      await db.insert(roles).values({
        ...role,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`'${role.name}' role created.`);
    } else {
      console.log(`'${role.name}' role already exists.`);
    }
  }

  console.log('Roles seeding complete.');
}

async function main() {
  try {
    await seedRoles();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding roles:', error);
    process.exit(1);
  }
}

main();
