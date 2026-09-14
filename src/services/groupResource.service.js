import { db } from '../db/index.js';
import { eq, and, asc, isNull, sql } from 'drizzle-orm';
import { groupResources } from '../db/schema/groupResources.js';
import ApiError from '../utils/api-error.js';
import { requireGroupCreator } from '../utils/group-helpers.js';

export class GroupResourceService {
  static async listResources(groupId) {
    return db.query.groupResources.findMany({
      where: and(eq(groupResources.groupId, groupId), isNull(groupResources.deletedAt)),
      orderBy: asc(groupResources.sortOrder),
    });
  }

  static async createResource(
    groupId,
    userId,
    { title, description, fileUrl, fileName, fileType, size }
  ) {
    await requireGroupCreator(groupId, userId, 'Only the group creator can add resources.');

    if (!title?.trim()) throw new ApiError(400, 'Title is required');
    if (!fileUrl?.trim()) throw new ApiError(400, 'A file is required');

    const [lastResource] = await db
      .select({ maxOrder: sql`MAX(${groupResources.sortOrder})` })
      .from(groupResources)
      .where(and(eq(groupResources.groupId, groupId), isNull(groupResources.deletedAt)));

    const [resource] = await db
      .insert(groupResources)
      .values({
        groupId,
        createdBy: userId,
        title: title.trim(),
        description: description?.trim() || null,
        fileUrl: fileUrl.trim(),
        fileName: fileName ?? null,
        fileType: fileType ?? null,
        size: size ?? null,
        sortOrder: Number(lastResource?.maxOrder ?? -1) + 1,
      })
      .returning();
    return resource;
  }

  static async _requireResource(resourceId, groupId) {
    const resource = await db.query.groupResources.findFirst({
      where: and(
        eq(groupResources.id, resourceId),
        eq(groupResources.groupId, groupId),
        isNull(groupResources.deletedAt)
      ),
    });
    if (!resource) throw new ApiError(404, 'Resource not found');
    return resource;
  }

  static async updateResource(resourceId, groupId, userId, { title, description }) {
    await requireGroupCreator(groupId, userId, 'Only the group creator can edit resources.');
    await this._requireResource(resourceId, groupId);

    const setData = {};
    if (title !== undefined) {
      if (!title.trim()) throw new ApiError(400, 'Title is required');
      setData.title = title.trim();
    }
    if (description !== undefined) setData.description = description?.trim() || null;
    setData.updatedAt = new Date();

    const [updated] = await db
      .update(groupResources)
      .set(setData)
      .where(eq(groupResources.id, resourceId))
      .returning();
    return updated;
  }

  static async deleteResource(resourceId, groupId, userId) {
    await requireGroupCreator(groupId, userId, 'Only the group creator can delete resources.');
    await this._requireResource(resourceId, groupId);

    await db
      .update(groupResources)
      .set({ deletedAt: new Date() })
      .where(eq(groupResources.id, resourceId));
    return { deleted: true };
  }
}

export default GroupResourceService;
