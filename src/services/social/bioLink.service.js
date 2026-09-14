import { db } from '../../db/index.js';
import { bioLinks } from '../../db/schema/index.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';

const BLOCKED_PROTOCOLS = /^(javascript|data|vbscript|file):/i;
const FREE_PLAN_LINK_LIMIT = 5;

function validateUrl(url) {
  const trimmed = url.trim();
  if (BLOCKED_PROTOCOLS.test(trimmed)) throw new ApiError(400, 'Invalid URL protocol');
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ApiError(400, 'URL must use http or https');
    }
  } catch {
    throw new ApiError(400, 'Invalid URL');
  }
  if (trimmed.length > 2000) throw new ApiError(400, 'URL too long');
  return trimmed;
}

function sanitizeTitle(title) {
  return title
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 100);
}

export class BioLinkService {
  static async createLink(userId, { title, url, icon, isPlus }) {
    const safeUrl = validateUrl(url);
    const safeTitle = sanitizeTitle(title);
    if (!safeTitle) throw new ApiError(400, 'Title is required');

    if (!isPlus) {
      const count = await db.$count(bioLinks, eq(bioLinks.userId, userId));
      if (count >= FREE_PLAN_LINK_LIMIT) {
        throw new ApiError(
          403,
          `Free plan is limited to ${FREE_PLAN_LINK_LIMIT} bio links. Upgrade to BriteSide Plus for unlimited links.`
        );
      }
    }

    const [link] = await db
      .insert(bioLinks)
      .values({ userId, title: safeTitle, url: safeUrl, icon: icon?.trim().slice(0, 50) || null })
      .returning();
    return link;
  }

  static async getMyLinks(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const [links, total] = await Promise.all([
      db.query.bioLinks.findMany({
        where: eq(bioLinks.userId, userId),
        orderBy: desc(bioLinks.createdAt),
        limit,
        offset,
      }),
      db.$count(bioLinks, eq(bioLinks.userId, userId)),
    ]);
    return { links, total, page, limit, hasMore: offset + links.length < total };
  }

  static async getUserLinks(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const [links, total] = await Promise.all([
      db.query.bioLinks.findMany({
        where: eq(bioLinks.userId, userId),
        columns: {
          id: true,
          title: true,
          url: true,
          icon: true,
          clickCount: true,
          createdAt: true,
        },
        orderBy: desc(bioLinks.createdAt),
        limit,
        offset,
      }),
      db.$count(bioLinks, eq(bioLinks.userId, userId)),
    ]);
    return { links, total, page, limit, hasMore: offset + links.length < total };
  }

  static async updateLink(linkId, userId, { title, url, icon }) {
    const existing = await db.query.bioLinks.findFirst({
      where: and(eq(bioLinks.id, linkId), eq(bioLinks.userId, userId)),
    });
    if (!existing) throw new ApiError(404, 'Link not found');

    const updates = { updatedAt: new Date() };
    if (title !== undefined) {
      const safeTitle = sanitizeTitle(title);
      if (!safeTitle) throw new ApiError(400, 'Title is required');
      updates.title = safeTitle;
    }
    if (url !== undefined) updates.url = validateUrl(url);
    if (icon !== undefined) updates.icon = icon?.trim().slice(0, 50) || null;

    const [updated] = await db
      .update(bioLinks)
      .set(updates)
      .where(and(eq(bioLinks.id, linkId), eq(bioLinks.userId, userId)))
      .returning();
    return updated;
  }

  static async deleteLink(linkId, userId) {
    const deleted = await db
      .delete(bioLinks)
      .where(and(eq(bioLinks.id, linkId), eq(bioLinks.userId, userId)))
      .returning();
    if (deleted.length === 0) throw new ApiError(404, 'Link not found');
    return { success: true };
  }

  static async trackClick(linkId) {
    const link = await db.query.bioLinks.findFirst({
      where: eq(bioLinks.id, linkId),
      columns: { id: true, url: true },
    });
    if (!link) throw new ApiError(404, 'Link not found');

    await db
      .update(bioLinks)
      .set({ clickCount: sql`${bioLinks.clickCount} + 1` })
      .where(eq(bioLinks.id, linkId));

    return { url: link.url };
  }
}
