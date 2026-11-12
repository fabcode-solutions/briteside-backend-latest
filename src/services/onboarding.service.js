import httpStatus from 'http-status';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { categories } from '../db/schema/categories.js';
import { groupCategories } from '../db/schema/groups.js';
import {
  userEventCategoryPreferences,
  userGroupCategoryPreferences,
} from '../db/schema/onboardingPreferences.js';
import ApiError from '../utils/api-error.js';

// Each setup step asks for at least this many picks (or every category, when
// fewer than this are active).
export const MIN_PICKS = 3;

const minPicksFor = available => Math.min(MIN_PICKS, available);

async function activeEventCategories() {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      emoji: categories.emoji,
      iconUrl: categories.iconUrl,
    })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.name));
}

async function activeGroupCategories() {
  return db
    .select({
      id: groupCategories.id,
      name: groupCategories.name,
      emoji: groupCategories.emoji,
      iconUrl: groupCategories.iconUrl,
    })
    .from(groupCategories)
    .where(eq(groupCategories.isActive, true))
    .orderBy(asc(groupCategories.name));
}

/** Category ids the user picked for the Events tab (empty if none). */
export async function getEventCategoryIds(userId) {
  if (!userId) return [];
  const rows = await db
    .select({ id: userEventCategoryPreferences.categoryId })
    .from(userEventCategoryPreferences)
    .where(eq(userEventCategoryPreferences.userId, userId));
  return rows.map(r => r.id);
}

/** Category ids the user picked for the Groups tab (empty if none). */
export async function getGroupCategoryIds(userId) {
  if (!userId) return [];
  const rows = await db
    .select({ id: userGroupCategoryPreferences.categoryId })
    .from(userGroupCategoryPreferences)
    .where(eq(userGroupCategoryPreferences.userId, userId));
  return rows.map(r => r.id);
}

/** Everything the setup screens / Settings → Interests page need. */
export async function getOnboardingState(userId) {
  const [user, eventCategories, groupCategoryList, eventIds, groupIds] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { onboardingCompletedAt: true },
    }),
    activeEventCategories(),
    activeGroupCategories(),
    getEventCategoryIds(userId),
    getGroupCategoryIds(userId),
  ]);

  return {
    completed: !!user?.onboardingCompletedAt,
    eventCategories,
    groupCategories: groupCategoryList,
    selectedEventCategoryIds: eventIds,
    selectedGroupCategoryIds: groupIds,
    minEventPicks: minPicksFor(eventCategories.length),
    minGroupPicks: minPicksFor(groupCategoryList.length),
  };
}

function uniqueIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(v => typeof v === 'string' && v.length > 0))];
}

/**
 * Replace the user's event + group interests and mark setup complete.
 * Only active categories are accepted; each list must meet its minimum.
 */
export async function saveOnboarding(userId, { eventCategoryIds, groupCategoryIds }) {
  const eventIds = uniqueIds(eventCategoryIds);
  const groupIds = uniqueIds(groupCategoryIds);

  const [validEvent, validGroup, eventCount, groupCount] = await Promise.all([
    eventIds.length
      ? db
          .select({ id: categories.id })
          .from(categories)
          .where(and(inArray(categories.id, eventIds), eq(categories.isActive, true)))
      : [],
    groupIds.length
      ? db
          .select({ id: groupCategories.id })
          .from(groupCategories)
          .where(and(inArray(groupCategories.id, groupIds), eq(groupCategories.isActive, true)))
      : [],
    activeEventCategories().then(r => r.length),
    activeGroupCategories().then(r => r.length),
  ]);

  const validEventIds = validEvent.map(r => r.id);
  const validGroupIds = validGroup.map(r => r.id);

  if (validEventIds.length < minPicksFor(eventCount)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Pick at least ${minPicksFor(eventCount)} event categories`
    );
  }
  if (validGroupIds.length < minPicksFor(groupCount)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Pick at least ${minPicksFor(groupCount)} group categories`
    );
  }

  await db.transaction(async tx => {
    await tx
      .delete(userEventCategoryPreferences)
      .where(eq(userEventCategoryPreferences.userId, userId));
    await tx
      .delete(userGroupCategoryPreferences)
      .where(eq(userGroupCategoryPreferences.userId, userId));

    if (validEventIds.length) {
      await tx
        .insert(userEventCategoryPreferences)
        .values(validEventIds.map(categoryId => ({ userId, categoryId })));
    }
    if (validGroupIds.length) {
      await tx
        .insert(userGroupCategoryPreferences)
        .values(validGroupIds.map(categoryId => ({ userId, categoryId })));
    }

    // Keep the original completion time when the user edits interests later.
    const [current] = await tx
      .select({ completedAt: users.onboardingCompletedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!current?.completedAt) {
      await tx.update(users).set({ onboardingCompletedAt: new Date() }).where(eq(users.id, userId));
    }
  });

  return getOnboardingState(userId);
}

export const OnboardingService = {
  getOnboardingState,
  saveOnboarding,
  getEventCategoryIds,
  getGroupCategoryIds,
};
