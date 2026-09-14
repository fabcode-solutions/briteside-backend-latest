import 'dotenv/config';
import { loadSecrets } from '../src/config/secrets.js';

// One-time backfill: group_course_lessons.module_id has no value for any
// lesson created before the modules/chapters feature. Creates one "Module 1"
// per course that has lessons, and assigns every existing lesson to it.
//
// Run this AFTER pushing/migrating the schema with module_id nullable, and
// BEFORE flipping module_id to .notNull() and pushing/migrating again.
// Run: node scripts/backfill-course-modules.js

process.env.USE_AWS_SECRETS = process.env.USE_AWS_SECRETS || 'true';
await loadSecrets();

const { db } = await import('../src/db/index.js');
const { groupCourses, groupCourseModules, groupCourseLessons } = await import(
  '../src/db/schema/groupCourses.js'
);
const { eq } = await import('drizzle-orm');

const courses = await db.select({ id: groupCourses.id }).from(groupCourses);

let migrated = 0;
for (const course of courses) {
  const existingLessons = await db
    .select({ id: groupCourseLessons.id })
    .from(groupCourseLessons)
    .where(eq(groupCourseLessons.courseId, course.id));

  if (existingLessons.length === 0) continue;

  await db.transaction(async tx => {
    const [module] = await tx
      .insert(groupCourseModules)
      .values({ courseId: course.id, title: 'Module 1', sortOrder: 0 })
      .returning();

    for (const lesson of existingLessons) {
      await tx
        .update(groupCourseLessons)
        .set({ moduleId: module.id })
        .where(eq(groupCourseLessons.id, lesson.id));
    }
  });
  migrated++;
}

console.log(`Backfilled ${migrated} course(s) with a default module.`);
process.exit(0);
