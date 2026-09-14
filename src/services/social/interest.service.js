import { db } from '../../db/index.js';
import { interestCategories, userInterests } from '../../db/schema/index.js';
import { eq, desc, and, or, sql, count, inArray } from 'drizzle-orm';

const MAX_USER_INTERESTS = 10;

/**
 * Normalize raw input to a URL-friendly slug.
 * "Machine Learnings" → "machine-learning"
 * "AI / ML" → "ai-ml"
 */
function normalizeToSlug(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/s$/, '') // strip simple trailing plural
    .replace(/^-|-$/g, '');
}

export class InterestService {
  /**
   * Get interest categories visible to a user: default (seeded) categories
   * plus any categories the user has personally added. Custom categories
   * created by other users are never included.
   */
  static async getInterestCategories(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const ownedRows = await db
      .select({ categoryId: userInterests.categoryId })
      .from(userInterests)
      .where(eq(userInterests.userId, userId));
    const ownedCategoryIds = ownedRows.map(row => row.categoryId);

    const visibleToUser =
      ownedCategoryIds.length > 0
        ? or(eq(interestCategories.isDefault, true), inArray(interestCategories.id, ownedCategoryIds))
        : eq(interestCategories.isDefault, true);

    const whereClause = and(eq(interestCategories.isActive, true), visibleToUser);

    const [results, [{ total }]] = await Promise.all([
      db.query.interestCategories.findMany({
        where: whereClause,
        orderBy: [interestCategories.usageCount, interestCategories.name],
        limit,
        offset,
      }),
      db.select({ total: count() }).from(interestCategories).where(whereClause),
    ]);

    return {
      categories: results,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    };
  }

  /**
   * Fuzzy search interest categories by name.
   * Layer 1: exact slug match
   * Layer 2: pg_trgm similarity on name (threshold 0.2)
   * Layer 3: ILIKE fallback on slug
   * Results ranked by similarity then usageCount.
   */
  static async searchInterests(query) {
    if (!query || !query.trim()) return [];

    const normalized = normalizeToSlug(query);
    const raw = query.trim();

    const results = await db
      .select({
        id: interestCategories.id,
        name: interestCategories.name,
        slug: interestCategories.slug,
        icon: interestCategories.icon,
        color: interestCategories.color,
        usageCount: interestCategories.usageCount,
        score: sql`similarity(${interestCategories.name}, ${raw})`,
      })
      .from(interestCategories)
      .where(
        and(
          eq(interestCategories.isActive, true),
          sql`(
            ${interestCategories.slug} = ${normalized}
            OR similarity(${interestCategories.name}, ${raw}) > 0.2
            OR ${interestCategories.slug} ILIKE ${'%' + normalized + '%'}
          )`
        )
      )
      .orderBy(
        sql`similarity(${interestCategories.name}, ${raw}) DESC`,
        desc(interestCategories.usageCount)
      )
      .limit(10);

    return results;
  }

  /**
   * Get all interests for a user
   */
  static async getUserInterests(userId) {
    return await db.query.userInterests.findMany({
      where: eq(userInterests.userId, userId),
      with: {
        category: true,
      },
      orderBy: desc(userInterests.intensity),
    });
  }

  /**
   * Add or update a single user interest (upsert).
   * Accepts { categoryId, intensity } or { name, intensity } (auto-creates category if new).
   * Max 10 interests per user — rejects new adds beyond the limit.
   */
  static async addUserInterest(
    userId,
    { categoryId, name, intensity = 50, icon, color, description }
  ) {
    let resolvedCategoryId = categoryId;

    // Resolve by name if categoryId not provided
    if (!resolvedCategoryId && name) {
      const slug = normalizeToSlug(name);
      const displayName = name.trim();

      const existing = await db.query.interestCategories.findFirst({
        where: eq(interestCategories.slug, slug),
      });

      if (existing) {
        resolvedCategoryId = existing.id;
      } else {
        // Create new category with optional display details
        const [created] = await db
          .insert(interestCategories)
          .values({
            name: displayName,
            slug,
            isActive: true,
            sortOrder: 0,
            usageCount: 0,
            ...(icon && { icon }),
            ...(color && { color }),
            ...(description && { description }),
          })
          .returning({ id: interestCategories.id });
        resolvedCategoryId = created.id;
      }
    }

    // Check if this (userId, categoryId) already exists → update path, skip count check
    const existingInterest = await db.query.userInterests.findFirst({
      where: and(
        eq(userInterests.userId, userId),
        eq(userInterests.categoryId, resolvedCategoryId)
      ),
    });

    if (!existingInterest) {
      // New interest — enforce max 10 limit
      const [{ value: currentCount }] = await db
        .select({ value: count() })
        .from(userInterests)
        .where(eq(userInterests.userId, userId));

      if (Number(currentCount) >= MAX_USER_INTERESTS) {
        const error = new Error(`Maximum ${MAX_USER_INTERESTS} interests allowed`);
        error.statusCode = 400;
        throw error;
      }
    }

    // Upsert
    await db
      .insert(userInterests)
      .values({
        userId,
        categoryId: resolvedCategoryId,
        intensity,
        isVisible: true,
      })
      .onConflictDoUpdate({
        target: [userInterests.userId, userInterests.categoryId],
        set: {
          intensity,
          updatedAt: new Date(),
        },
      });

    // Increment usageCount only on first add
    if (!existingInterest) {
      await db
        .update(interestCategories)
        .set({ usageCount: sql`${interestCategories.usageCount} + 1` })
        .where(eq(interestCategories.id, resolvedCategoryId));
    }

    return await db.query.userInterests.findFirst({
      where: and(
        eq(userInterests.userId, userId),
        eq(userInterests.categoryId, resolvedCategoryId)
      ),
      with: { category: true },
    });
  }

  /**
   * Remove a user interest (hard delete).
   * Decrements usageCount on the category.
   */
  static async removeUserInterest(userId, categoryId) {
    const existing = await db.query.userInterests.findFirst({
      where: and(eq(userInterests.userId, userId), eq(userInterests.categoryId, categoryId)),
    });

    if (!existing) return null;

    await db
      .delete(userInterests)
      .where(and(eq(userInterests.userId, userId), eq(userInterests.categoryId, categoryId)));

    // Decrement usageCount (floor at 0)
    await db
      .update(interestCategories)
      .set({ usageCount: sql`GREATEST(${interestCategories.usageCount} - 1, 0)` })
      .where(eq(interestCategories.id, categoryId));

    return { deleted: true };
  }

  /**
   * Bulk replace all user interests (legacy — kept for compatibility)
   */
  static async updateUserInterests(userId, interests) {
    await db.delete(userInterests).where(eq(userInterests.userId, userId));

    if (interests.length > 0) {
      const interestData = interests.map(interest => ({
        userId,
        categoryId: interest.categoryId,
        intensity: interest.intensity,
        isVisible: interest.isVisible ?? true,
      }));
      await db.insert(userInterests).values(interestData);
    }

    return await this.getUserInterests(userId);
  }
}
