import { db } from '../../db/index.js';
import { pinnedProfiles, users, socialProfiles } from '../../db/schema/index.js';
import { eq, and, or, sql, count, desc } from 'drizzle-orm';

/**
 * Pinned profiles — a user bookmarking another user's profile for quick access.
 */
export class PinnedProfileService {
  static async togglePin(userId, targetUserId) {
    const existing = await db.query.pinnedProfiles.findFirst({
      where: and(eq(pinnedProfiles.userId, userId), eq(pinnedProfiles.pinnedUserId, targetUserId)),
    });

    if (existing) {
      await db.delete(pinnedProfiles).where(eq(pinnedProfiles.id, existing.id));
      return { pinned: false };
    }

    await db.insert(pinnedProfiles).values({ userId, pinnedUserId: targetUserId });
    return { pinned: true };
  }

  static async isPinned(userId, targetUserId) {
    const existing = await db.query.pinnedProfiles.findFirst({
      where: and(eq(pinnedProfiles.userId, userId), eq(pinnedProfiles.pinnedUserId, targetUserId)),
      columns: { id: true },
    });
    return !!existing;
  }

  static async getPinnedProfiles(userId, page = 1, limit = 20, search = '') {
    const offset = (page - 1) * limit;

    // Filters on the joined `users` row, so this can't go through
    // db.query.pinnedProfiles (the relational API can't scope a where
    // condition to a related table) — use the core query builder instead.
    const nameCondition = search
      ? or(
          sql`${users.username} ILIKE ${`%${search}%`}`,
          sql`${users.firstName} ILIKE ${`%${search}%`}`,
          sql`${users.lastName} ILIKE ${`%${search}%`}`
        )
      : undefined;

    const whereCondition = and(eq(pinnedProfiles.userId, userId), nameCondition);

    const [rows, [{ value: total }]] = await Promise.all([
      db
        .select({
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          image: users.image,
          bio: socialProfiles.bio,
          pinnedAt: pinnedProfiles.createdAt,
        })
        .from(pinnedProfiles)
        .innerJoin(users, eq(users.id, pinnedProfiles.pinnedUserId))
        .leftJoin(socialProfiles, eq(socialProfiles.userId, users.id))
        .where(whereCondition)
        .orderBy(desc(pinnedProfiles.createdAt))
        .limit(limit)
        .offset(offset),
      // Total is always the unfiltered pin count — it feeds the menu badge,
      // which shouldn't jump around while the user is typing a search.
      db.select({ value: count() }).from(pinnedProfiles).where(eq(pinnedProfiles.userId, userId)),
    ]);

    return {
      items: rows,
      hasMore: rows.length === limit,
      total,
    };
  }
}
