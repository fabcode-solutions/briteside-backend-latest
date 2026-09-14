import { db } from '../db/index.js';
import { organizers, organizerPresets } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';

export class OrganizerPresetService {
  static async #resolveOrganizer(userId) {
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, userId),
    });
    if (!organizer) throw new ApiError(404, 'Organizer profile not found');
    return organizer;
  }

  static async createPreset(userId, data) {
    const organizer = await this.#resolveOrganizer(userId);

    if (data.isDefault) {
      await db
        .update(organizerPresets)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(eq(organizerPresets.organizerId, organizer.id), eq(organizerPresets.isDefault, true))
        );
    }

    const [preset] = await db
      .insert(organizerPresets)
      .values({
        ...data,
        organizerId: organizer.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return preset;
  }

  static async listPresets(userId) {
    const organizer = await this.#resolveOrganizer(userId);
    return db.query.organizerPresets.findMany({
      where: eq(organizerPresets.organizerId, organizer.id),
      orderBy: (t, { desc }) => [desc(t.isDefault), desc(t.createdAt)],
    });
  }

  static async getPreset(userId, presetId) {
    const organizer = await this.#resolveOrganizer(userId);
    const preset = await db.query.organizerPresets.findFirst({
      where: and(eq(organizerPresets.id, presetId), eq(organizerPresets.organizerId, organizer.id)),
    });
    if (!preset) throw new ApiError(404, 'Preset not found');
    return preset;
  }

  static async updatePreset(userId, presetId, data) {
    const organizer = await this.#resolveOrganizer(userId);

    const existing = await db.query.organizerPresets.findFirst({
      where: and(eq(organizerPresets.id, presetId), eq(organizerPresets.organizerId, organizer.id)),
    });
    if (!existing) throw new ApiError(404, 'Preset not found');

    if (data.isDefault === true && !existing.isDefault) {
      await db
        .update(organizerPresets)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(eq(organizerPresets.organizerId, organizer.id), eq(organizerPresets.isDefault, true))
        );
    }

    const [updated] = await db
      .update(organizerPresets)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(organizerPresets.id, presetId), eq(organizerPresets.organizerId, organizer.id)))
      .returning();

    return updated;
  }

  static async deletePreset(userId, presetId) {
    const organizer = await this.#resolveOrganizer(userId);

    const [deleted] = await db
      .delete(organizerPresets)
      .where(and(eq(organizerPresets.id, presetId), eq(organizerPresets.organizerId, organizer.id)))
      .returning();

    if (!deleted) throw new ApiError(404, 'Preset not found');
    return deleted;
  }

  static async validatePresetOwnership(organizerId, presetId) {
    const preset = await db.query.organizerPresets.findFirst({
      where: and(eq(organizerPresets.id, presetId), eq(organizerPresets.organizerId, organizerId)),
    });
    if (!preset) throw new ApiError(403, 'Preset does not belong to this organizer');
    return preset;
  }
}
