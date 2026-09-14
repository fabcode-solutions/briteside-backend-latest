import { db } from '../../db/index.js';
import { storyCollections, storyCollectionItems } from '../../db/schema/index.js';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { storyLikes, postLikes } from '../../db/schema/index.js';

export class StoryCollectionService {
  static async createCollection(userId, { name, coverImage, sortOrder = 0 }) {
    const [collection] = await db
      .insert(storyCollections)
      .values({ userId, name, coverImage: coverImage || null, sortOrder })
      .returning();
    return collection;
  }

  static async getMyCollections(userId) {
    return db.query.storyCollections.findMany({
      where: eq(storyCollections.userId, userId),
      orderBy: [asc(storyCollections.sortOrder), desc(storyCollections.createdAt)],
    });
  }

  static async getUserCollections(userId) {
    return db.query.storyCollections.findMany({
      where: eq(storyCollections.userId, userId),
      orderBy: [asc(storyCollections.sortOrder), desc(storyCollections.createdAt)],
    });
  }

  static async getCollectionItems(collectionId, page = 1, limit = 20, userId = null) {
    const collection = await db.query.storyCollections.findFirst({
      where: eq(storyCollections.id, collectionId),
    });
    if (!collection) throw new ApiError(404, 'Collection not found');

    const offset = (page - 1) * limit;
    const rows = await db.query.storyCollectionItems.findMany({
      where: eq(storyCollectionItems.collectionId, collectionId),
      with: {
        story: {
          columns: {
            id: true,
            mediaUrl: true,
            mediaType: true,
            caption: true,
            expiresAt: true,
            createdAt: true,
            likesCount: true,
            commentsCount: true,
            sharesCount: true,
            viewsCount: true,
          },
          with: {
            user: {
              columns: { id: true, username: true, firstName: true, lastName: true, image: true },
            },
            likes: userId
              ? {
                  where: eq(storyLikes.userId, userId),
                  columns: { id: true },
                }
              : undefined,
          },
        },
        post: {
          columns: {
            id: true,
            mediaUrls: true,
            mediaTypes: true,
            caption: true,
            createdAt: true,
            likesCount: true,
            commentsCount: true,
            sharesCount: true,
          },
          with: {
            user: {
              columns: { id: true, username: true, firstName: true, lastName: true, image: true },
            },
            likes: userId
              ? {
                  where: eq(postLikes.userId, userId),
                  columns: { id: true },
                }
              : undefined,
          },
        },
      },
      orderBy: desc(storyCollectionItems.addedAt),
      limit: limit + 1,
      offset,
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(row => ({
      ...row,
      story: row.story
        ? {
            ...row.story,
            isLiked: (row.story.likes?.length ?? 0) > 0,
            likes: undefined,
          }
        : null,
      post: row.post
        ? {
            ...row.post,
            isLiked: (row.post.likes?.length ?? 0) > 0,
            likes: undefined,
          }
        : null,
    }));

    return {
      collection,
      items,
      pagination: { page, limit, hasMore },
    };
  }

  static async updateCollection(collectionId, userId, data) {
    const existing = await db.query.storyCollections.findFirst({
      where: and(eq(storyCollections.id, collectionId), eq(storyCollections.userId, userId)),
    });
    if (!existing) throw new ApiError(404, 'Collection not found');

    const updates = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.coverImage !== undefined) updates.coverImage = data.coverImage;
    if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

    const [updated] = await db
      .update(storyCollections)
      .set(updates)
      .where(and(eq(storyCollections.id, collectionId), eq(storyCollections.userId, userId)))
      .returning();
    return updated;
  }

  static async deleteCollection(collectionId, userId) {
    const deleted = await db
      .delete(storyCollections)
      .where(and(eq(storyCollections.id, collectionId), eq(storyCollections.userId, userId)))
      .returning();
    if (deleted.length === 0) throw new ApiError(404, 'Collection not found');
    return { success: true };
  }

  static async addItem(collectionId, userId, { itemType, storyId, postId }) {
    const collection = await db.query.storyCollections.findFirst({
      where: and(eq(storyCollections.id, collectionId), eq(storyCollections.userId, userId)),
    });
    if (!collection) throw new ApiError(404, 'Collection not found');

    if (!['story', 'post'].includes(itemType))
      throw new ApiError(400, 'itemType must be story or post');
    if (itemType === 'story' && !storyId) throw new ApiError(400, 'storyId required');
    if (itemType === 'post' && !postId) throw new ApiError(400, 'postId required');

    const existing = await db.query.storyCollectionItems.findFirst({
      where: and(
        eq(storyCollectionItems.collectionId, collectionId),
        itemType === 'story'
          ? eq(storyCollectionItems.storyId, storyId)
          : eq(storyCollectionItems.postId, postId)
      ),
    });
    if (existing) throw new ApiError(409, 'Item already in collection');

    const [item] = await db
      .insert(storyCollectionItems)
      .values({ collectionId, itemType, storyId: storyId || null, postId: postId || null })
      .returning();

    await db
      .update(storyCollections)
      .set({ itemsCount: sql`${storyCollections.itemsCount} + 1`, updatedAt: new Date() })
      .where(eq(storyCollections.id, collectionId));

    return item;
  }

  static async removeItem(collectionId, itemId, userId) {
    const collection = await db.query.storyCollections.findFirst({
      where: and(eq(storyCollections.id, collectionId), eq(storyCollections.userId, userId)),
    });
    if (!collection) throw new ApiError(404, 'Collection not found');

    const deleted = await db
      .delete(storyCollectionItems)
      .where(
        and(
          eq(storyCollectionItems.id, itemId),
          eq(storyCollectionItems.collectionId, collectionId)
        )
      )
      .returning();
    if (deleted.length === 0) throw new ApiError(404, 'Item not found');

    await db
      .update(storyCollections)
      .set({
        itemsCount: sql`GREATEST(${storyCollections.itemsCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(storyCollections.id, collectionId));

    return { success: true };
  }

  // Called from createStory/createPost — never blocks content creation
  static async addItemSilent(collectionId, userId, itemData) {
    try {
      await StoryCollectionService.addItem(collectionId, userId, itemData);
    } catch {
      // intentional no-op
    }
  }
}
