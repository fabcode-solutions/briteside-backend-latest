/**
 * src/services/adminCategoryRegistry.service.js
 *
 * Shared admin CRUD for the "categories" tables that all follow the same
 * shape (id/name/isActive, an optional slug/description/etc.) — interest
 * categories (Feed), group categories, and talent categories. Mirrors the
 * exact semantics already used for Events' categories in admin.service.js
 * (duplicate-name check on create/update, 404 on missing id) so all four
 * category types behave identically from an admin's perspective, without
 * four hand-copied service files.
 *
 * Events' own category functions in admin.service.js are left untouched —
 * that code shipped before this registry existed and there's no need to
 * migrate it onto this factory just for the sake of it.
 */

import httpStatus from 'http-status';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import ApiError from '../utils/api-error.js';

/**
 * @param {object} table - the drizzle table object (must have id, name, isActive columns)
 * @param {string} entityLabel - human-readable label for error messages, e.g. "Group category"
 */
export function makeCategoryAdminService(table, entityLabel) {
  return {
    async list({ includeInactive = true } = {}) {
      if (includeInactive) {
        return db.select().from(table).orderBy(table.name);
      }
      return db.select().from(table).where(eq(table.isActive, true)).orderBy(table.name);
    },

    async create(data) {
      const [existing] = await db.select().from(table).where(eq(table.name, data.name)).limit(1);

      if (existing) {
        throw new ApiError(httpStatus.CONFLICT, `${entityLabel} with this name already exists`);
      }

      const [row] = await db.insert(table).values(data).returning();
      return row;
    },

    async update(id, updateData) {
      const [existing] = await db.select().from(table).where(eq(table.id, id)).limit(1);
      if (!existing) {
        throw new ApiError(httpStatus.NOT_FOUND, `${entityLabel} not found`);
      }

      if (updateData.name && updateData.name !== existing.name) {
        const [nameConflict] = await db
          .select()
          .from(table)
          .where(and(eq(table.name, updateData.name), sql`${table.id} != ${id}`))
          .limit(1);
        if (nameConflict) {
          throw new ApiError(httpStatus.CONFLICT, `${entityLabel} with this name already exists`);
        }
      }

      const [row] = await db.update(table).set(updateData).where(eq(table.id, id)).returning();
      return row;
    },

    async remove(id) {
      const [existing] = await db.select().from(table).where(eq(table.id, id)).limit(1);
      if (!existing) {
        throw new ApiError(httpStatus.NOT_FOUND, `${entityLabel} not found`);
      }
      await db.delete(table).where(eq(table.id, id));
    },
  };
}
