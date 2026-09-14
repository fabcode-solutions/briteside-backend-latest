import 'dotenv/config';
import { db } from '../src/db/index.js';
import { users, roles, userRoles } from '../src/db/schema/index.js';
import { eq, and } from 'drizzle-orm';

async function seedAdminUser() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/seed-admin-user.js <email>');
    process.exit(1);
  }

  console.log(`Assigning admin role to user with email: ${email}`);

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    console.error(`User with email "${email}" not found.`);
    process.exit(1);
  }

  const adminRole = await db.query.roles.findFirst({
    where: eq(roles.name, 'admin'),
  });

  if (!adminRole) {
    console.error('Admin role not found. Run seed-roles.js first.');
    process.exit(1);
  }

  const existing = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, user.id), eq(userRoles.roleId, adminRole.id)),
  });

  if (existing) {
    console.log(`User "${email}" already has the admin role.`);
    process.exit(0);
  }

  await db.insert(userRoles).values({
    userId: user.id,
    roleId: adminRole.id,
  });

  console.log(`Admin role assigned to "${email}" (${user.firstName} ${user.lastName}).`);
}

seedAdminUser()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
