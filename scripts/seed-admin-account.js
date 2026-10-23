import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import { users, roles, userRoles } from '../src/db/schema/index.js';

// Creates (or updates) an admin account. Safe to re-run.
//
//   node scripts/seed-admin-account.js
//   ADMIN_EMAIL=someone@example.com ADMIN_PASSWORD='...' node scripts/seed-admin-account.js
//
// The password is never stored in the repo: pass ADMIN_PASSWORD, or one is generated and printed once.
// If the user already exists the password is NOT changed unless RESET_PASSWORD=1.

const EMAIL = (process.env.ADMIN_EMAIL || 'fabdevteam.qa@gmail.com').trim().toLowerCase();
const FIRST_NAME = process.env.ADMIN_FIRST_NAME || 'Fab';
const LAST_NAME = process.env.ADMIN_LAST_NAME || 'Admin';
const USERNAME = process.env.ADMIN_USERNAME || EMAIL.split('@')[0].replace(/[^a-z0-9_.]/g, '').slice(0, 40);
const ROLES = ['authenticated', 'admin'];

async function ensureRole(name, description) {
  const existing = await db.query.roles.findFirst({ where: eq(roles.name, name) });
  if (existing) return existing;
  const [created] = await db.insert(roles).values({ name, description }).returning();
  console.log(`Created role "${name}"`);
  return created;
}

async function main() {
  const dbTarget = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).host + new URL(process.env.DATABASE_URL).pathname
    : `${process.env.POSTGRESQL_HOST}/${process.env.POSTGRESQL_DB_NAME}`;
  console.log(`Target database: ${dbTarget}`);

  const roleRows = {};
  for (const name of ROLES) {
    roleRows[name] = await ensureRole(name, name === 'admin' ? 'Administrator with full platform access.' : 'Default role for all authenticated users.');
  }

  let user = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
  let generated = null;

  if (!user) {
    const password = process.env.ADMIN_PASSWORD || (generated = crypto.randomBytes(12).toString('base64url'));
    const passwordHash = await bcrypt.hash(password, 10);
    // phone_number is required + unique: use a clearly fake placeholder derived from the id.
    const phoneNumber = `+0${Date.now().toString().slice(-12)}`;

    [user] = await db
      .insert(users)
      .values({
        email: EMAIL,
        username: USERNAME,
        passwordHash,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        name: `${FIRST_NAME} ${LAST_NAME}`,
        phoneNumber,
        dob: '1990-01-01',
        isEmailVerified: true,
        emailVerified: new Date(),
        isVerifiedAdult: true,
      })
      .returning();
    console.log(`Created user ${EMAIL}`);
  } else if (process.env.RESET_PASSWORD === '1') {
    const password = process.env.ADMIN_PASSWORD || (generated = crypto.randomBytes(12).toString('base64url'));
    await db.update(users).set({ passwordHash: await bcrypt.hash(password, 10) }).where(eq(users.id, user.id));
    console.log(`Reset password for ${EMAIL}`);
  } else {
    console.log(`User ${EMAIL} already exists (password unchanged).`);
  }

  for (const name of ROLES) {
    const has = await db.query.userRoles.findFirst({
      where: and(eq(userRoles.userId, user.id), eq(userRoles.roleId, roleRows[name].id)),
    });
    if (!has) {
      await db.insert(userRoles).values({ userId: user.id, roleId: roleRows[name].id });
      console.log(`Granted role "${name}"`);
    }
  }

  console.log(`\nAdmin ready: ${EMAIL}`);
  if (generated) console.log(`Generated password (shown once, change it after first login): ${generated}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
