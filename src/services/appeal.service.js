import { db } from '../db/index.js';
import { suspensionAppeals } from '../db/schema/appeals.js';
import { users } from '../db/schema/users.js';
import { auditLogs } from '../db/schema/admin.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';
import { sendAppealReceivedEmail, sendAppealReviewedEmail } from './mail.service.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';

const computeDaysRemaining = suspendedUntil => {
  if (!suspendedUntil) return null;
  const ms = new Date(suspendedUntil) - new Date();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
};

const suspensionUserColumns = {
  id: true,
  username: true,
  email: true,
  firstName: true,
  lastName: true,
  isSuspended: true,
  suspendedUntil: true,
  suspensionReason: true,
};

export const submitAppeal = async (userId, reason) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  if (!user.isSuspended) throw new ApiError(httpStatus.BAD_REQUEST, 'Account is not suspended');

  const existing = await db.query.suspensionAppeals.findFirst({
    where: and(eq(suspensionAppeals.userId, userId), eq(suspensionAppeals.status, 'pending')),
  });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'You already have a pending appeal');

  const [appeal] = await db.insert(suspensionAppeals).values({ userId, reason }).returning();

  TextModerationService.flagAsync({
    entityType: TEXT_ENTITY.SUPPORT,
    entityId: appeal.id,
    entityCreatorId: userId,
    texts: [reason],
  });

  sendAppealReceivedEmail({
    to: user.email,
    username: user.username || user.firstName,
  }).catch(() => {});

  return {
    ...appeal,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isSuspended: user.isSuspended,
      suspendedUntil: user.suspendedUntil,
      suspensionReason: user.suspensionReason,
    },
    daysRemaining: computeDaysRemaining(user.suspendedUntil),
  };
};

export const getUserAppeals = async userId => {
  const rows = await db.query.suspensionAppeals.findMany({
    where: eq(suspensionAppeals.userId, userId),
    with: { user: { columns: suspensionUserColumns } },
    orderBy: desc(suspensionAppeals.createdAt),
  });
  return rows.map(r => ({ ...r, daysRemaining: computeDaysRemaining(r.user?.suspendedUntil) }));
};

export const listAppeals = async ({ page = 1, limit = 20, status } = {}) => {
  const conditions = [];
  if (status) conditions.push(eq(suspensionAppeals.status, status));
  const where = conditions.length ? and(...conditions) : undefined;
  const offset = (page - 1) * limit;

  const [rows, [{ total }]] = await Promise.all([
    db.query.suspensionAppeals.findMany({
      where,
      with: {
        user: { columns: suspensionUserColumns },
        admin: { columns: { id: true, username: true, firstName: true, lastName: true } },
      },
      orderBy: desc(suspensionAppeals.createdAt),
      limit,
      offset,
    }),
    db
      .select({ total: sql`count(*)::int` })
      .from(suspensionAppeals)
      .where(where),
  ]);

  return {
    appeals: rows.map(r => ({ ...r, daysRemaining: computeDaysRemaining(r.user?.suspendedUntil) })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

/**
 * @param {'approved'|'rejected'} decision
 * @param {Date|null} newSuspendedUntil  null = lift suspension fully (only on approve)
 */
export const reviewAppeal = async (
  appealId,
  decision,
  adminResponse,
  newSuspendedUntil,
  adminId
) => {
  const appeal = await db.query.suspensionAppeals.findFirst({
    where: eq(suspensionAppeals.id, appealId),
    with: { user: true },
  });
  if (!appeal) throw new ApiError(httpStatus.NOT_FOUND, 'Appeal not found');
  if (appeal.status !== 'pending')
    throw new ApiError(httpStatus.BAD_REQUEST, 'Appeal already reviewed');

  const now = new Date();

  const [updated] = await db
    .update(suspensionAppeals)
    .set({
      status: decision,
      adminId,
      adminResponse: adminResponse ?? null,
      newSuspendedUntil: decision === 'approved' ? (newSuspendedUntil ?? null) : null,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(suspensionAppeals.id, appealId))
    .returning();

  if (decision === 'approved') {
    if (!newSuspendedUntil) {
      await db
        .update(users)
        .set({ isSuspended: false, suspendedUntil: null, suspensionReason: null })
        .where(eq(users.id, appeal.userId));
    } else {
      await db
        .update(users)
        .set({ suspendedUntil: newSuspendedUntil })
        .where(eq(users.id, appeal.userId));
    }
  }

  await db.insert(auditLogs).values({
    userId: adminId,
    action: `appeal_${decision}`,
    resourceType: 'suspension_appeal',
    resourceId: appealId,
    changes: { targetUserId: appeal.userId, adminResponse, newSuspendedUntil },
    createdAt: now,
  });

  sendAppealReviewedEmail({
    to: appeal.user.email,
    username: appeal.user.username || appeal.user.firstName,
    status: decision,
    adminResponse,
    newSuspendedUntil: decision === 'approved' ? newSuspendedUntil : null,
  }).catch(() => {});

  return updated;
};
