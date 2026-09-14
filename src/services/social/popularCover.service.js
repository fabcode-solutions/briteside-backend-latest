import { db } from '../../db/index.js';
import { popularLinkCovers } from '../../db/schema/index.js';
import { eq, asc, sql } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';

const MAX_NAME_LENGTH = 30;
const URL_PATTERN = /^https?:\/\/.+|^\/.+/i; 


export class PopularCoverService {
  static async list() {
    return db.query.popularLinkCovers.findMany({
      orderBy: asc(popularLinkCovers.displayOrder),
    });
  }

  static async add(userId, { name, url, coverType = 'image' }) {
    if (!name?.trim()) {
      throw new ApiError(400, 'Name is required');
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      throw new ApiError(400, `Name must be ${MAX_NAME_LENGTH} characters or fewer`);
    }
    if (!url?.trim()) {
      throw new ApiError(400, 'A logo image is required');
    }
    if (!URL_PATTERN.test(url.trim())) {
      throw new ApiError(400, 'Logo image URL is invalid');
    }

    const [{ maxOrder }] = await db
      .select({ maxOrder: sql`COALESCE(MAX(${popularLinkCovers.displayOrder}), 0)` })
      .from(popularLinkCovers);

    const [created] = await db
      .insert(popularLinkCovers)
      .values({
        name: name.trim(),
        url: url.trim(),
        coverType,
        createdByUserId: userId,
        displayOrder: Number(maxOrder) + 1,
      })
      .returning();

    return created;
  }

  static async remove(userId, coverId) {
    const cover = await db.query.popularLinkCovers.findFirst({
      where: eq(popularLinkCovers.id, coverId),
    });
    if (!cover) {
      throw new ApiError(404, 'Logo not found');
    }

    // System-seeded logos (no owner) aren't removable by regular users.
    if (!cover.createdByUserId) {
      throw new ApiError(403, 'This logo cannot be removed');
    }
    if (cover.createdByUserId !== userId) {
      throw new ApiError(403, 'You can only remove logos you added');
    }

    await db.delete(popularLinkCovers).where(eq(popularLinkCovers.id, coverId));
    return { deleted: true };
  }

  // Admin override — can edit any logo regardless of owner, including
  // system-seeded ones (no createdByUserId). Only provided fields are changed.
  static async adminUpdate(coverId, { name, url, coverType } = {}) {
    const cover = await db.query.popularLinkCovers.findFirst({
      where: eq(popularLinkCovers.id, coverId),
    });
    if (!cover) {
      throw new ApiError(404, 'Logo not found');
    }

    const updates = {};

    if (name !== undefined) {
      if (!name?.trim()) {
        throw new ApiError(400, 'Name is required');
      }
      if (name.trim().length > MAX_NAME_LENGTH) {
        throw new ApiError(400, `Name must be ${MAX_NAME_LENGTH} characters or fewer`);
      }
      updates.name = name.trim();
    }

    if (url !== undefined) {
      if (!url?.trim()) {
        throw new ApiError(400, 'A logo image is required');
      }
      if (!URL_PATTERN.test(url.trim())) {
        throw new ApiError(400, 'Logo image URL is invalid');
      }
      updates.url = url.trim();
    }

    if (coverType !== undefined) {
      updates.coverType = coverType;
    }

    if (Object.keys(updates).length === 0) {
      return cover;
    }

    updates.updatedAt = new Date();

    const [updated] = await db
      .update(popularLinkCovers)
      .set(updates)
      .where(eq(popularLinkCovers.id, coverId))
      .returning();

    return updated;
  }

  // Admin override — can remove any logo regardless of owner, including
  // system-seeded ones (no createdByUserId), unlike the owner-scoped remove().
  static async adminRemove(coverId) {
    const cover = await db.query.popularLinkCovers.findFirst({
      where: eq(popularLinkCovers.id, coverId),
    });
    if (!cover) {
      throw new ApiError(404, 'Logo not found');
    }

    await db.delete(popularLinkCovers).where(eq(popularLinkCovers.id, coverId));
    return { deleted: true };
  }
}