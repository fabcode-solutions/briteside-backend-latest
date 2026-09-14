import 'dotenv/config';
/**
 * Seed universal team role templates into event_team_roles.
 *
 * These roles are platform-level (no team/event FK) and are normally
 * inserted by the 0032 migration. Run this script only when you need to
 * reseed a dev database without re-running migrations.
 *
 * Usage:
 *   node scripts/seed-event-team-roles.js
 *
 * Roles that already exist (same name) are skipped.
 */
import { db } from '../src/db/index.js';
import { eventTeamRoles } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { ROLE_TEMPLATES } from '../src/config/event-team-permissions.js';

async function seedTeamRoles() {
  console.log('Seeding universal team roles...\n');

  for (const template of Object.values(ROLE_TEMPLATES)) {
    const existing = await db.query.eventTeamRoles.findFirst({
      where: eq(eventTeamRoles.name, template.name),
    });

    if (existing) {
      console.log(`  ⏭  '${template.name}' already exists — skipped`);
      continue;
    }

    await db.insert(eventTeamRoles).values({
      name: template.name,
      permissions: template.permissions,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`  ✅  '${template.name}' created (${template.permissions.length} permissions)`);
  }

  console.log('\nDone.');
}

async function main() {
  try {
    await seedTeamRoles();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding team roles:', error);
    process.exit(1);
  }
}

main();
