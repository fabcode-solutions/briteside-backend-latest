import { db } from '../db/index.js';
import { userDevices } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

/**
 * Register (or refresh) a push token for one app install.
 *
 * Upserts by notificationUid rather than (userId, platform) — a push token
 * uniquely identifies one device install, and a reinstall / token refresh on
 * that same device should update its existing row, not create a duplicate.
 * This also covers the token moving to a different account (e.g. someone
 * logs out and a different user logs in on the same phone): the row's
 * userId is reassigned to whoever registered it most recently.
 */
export const registerDevice = async (
  userId,
  { notificationUid, platform, deviceModel, appVersion }
) => {
  const existing = await db.query.userDevices.findFirst({
    where: eq(userDevices.notificationUid, notificationUid),
  });

  if (existing) {
    const [updated] = await db
      .update(userDevices)
      .set({
        userId,
        platform,
        deviceModel,
        appVersion,
        isActive: true,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userDevices.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(userDevices)
    .values({ userId, notificationUid, platform, deviceModel, appVersion })
    .returning();
  return created;
};

/**
 * Deactivate one device's push token (logout / token revoked). Soft-delete
 * only — the row stays for history, it just stops receiving pushes.
 */
export const deactivateDevice = async (userId, notificationUid) => {
  // Scoped to both the token AND the caller's own userId — a mismatch just
  // matches zero rows instead of touching another user's device.
  const [updated] = await db
    .update(userDevices)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(userDevices.notificationUid, notificationUid), eq(userDevices.userId, userId)))
    .returning();
  return updated ?? null;
};

/**
 * All currently-active devices for a user — what a push-sending step would
 * fan a notification out to.
 */
export const getActiveDevicesForUser = async userId => {
  return db.query.userDevices.findMany({
    where: (fields, { eq: eqOp, and: andOp }) =>
      andOp(eqOp(fields.userId, userId), eqOp(fields.isActive, true)),
  });
};
