/**
 * One-off backfill: talent_profiles.category (free text) → talent_categories
 * table + talent_profiles.category_id (FK). Safe to re-run — every insert is
 * ON CONFLICT DO NOTHING on the unique name, and the UPDATE only touches rows
 * where category_id IS NULL.
 *
 * Usage: node scripts/backfill-talent-categories.js [--local]
 */
import 'dotenv/config';

if (process.argv.includes('--local')) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
} else {
  const { loadSecrets } = await import('../src/config/secrets.js');
  await loadSecrets();
}

const { db } = await import('../src/db/index.js');
const { talentProfiles, talentCategories } = await import('../src/db/schema/index.js');
const { sql, isNull, and, eq } = await import('drizzle-orm');

function normalizeToSlug(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const distinctRows = await db.execute(
  sql`SELECT DISTINCT category FROM talent_profiles WHERE category IS NOT NULL AND category_id IS NULL`
);
const distinctNames = distinctRows.rows.map(r => r.category).filter(Boolean);

console.log(`Found ${distinctNames.length} distinct unmigrated category name(s).`);

for (const name of distinctNames) {
  const slug = normalizeToSlug(name);
  await db.insert(talentCategories).values({ name, slug }).onConflictDoNothing({ target: talentCategories.name });
}

for (const name of distinctNames) {
  const [category] = await db.select().from(talentCategories).where(eq(talentCategories.name, name)).limit(1);
  if (!category) continue;
  await db
    .update(talentProfiles)
    .set({ categoryId: category.id })
    .where(and(eq(talentProfiles.category, name), isNull(talentProfiles.categoryId)));
}

const [{ count: unresolved }] = (
  await db.execute(
    sql`SELECT count(*)::int as count FROM talent_profiles WHERE category_id IS NULL AND category IS NOT NULL`
  )
).rows;

console.log(`Backfill complete. Unresolved profiles remaining: ${unresolved}`);
if (unresolved > 0) {
  console.log('Investigate before wiring any UI to categoryId — some profiles have no matching category row.');
}
process.exit(0);
