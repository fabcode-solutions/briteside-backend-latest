import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { events } from '../db/schema/events.js';
import { groups } from '../db/schema/groups.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { sql, and, isNull, eq, notInArray } from 'drizzle-orm';
import { userBlocks } from '../db/schema/index.js';

function buildTsQuery(q) {
  const sanitized = q.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const words = sanitized.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return words.map(w => `${w}:*`).join(' & ');
}

export const SearchService = {
  async universalSearch({ q, limit, viewerId }) {
    const tsQuery = buildTsQuery(q);
    const likeQ = `%${q}%`;
    let blockedIds = [];
    if (viewerId) {
      const [blockedRows, blockerRows] = await Promise.all([
        db
          .select({ userId: userBlocks.blockedId })
          .from(userBlocks)
          .where(eq(userBlocks.blockerId, viewerId)),
        db
          .select({ userId: userBlocks.blockerId })
          .from(userBlocks)
          .where(eq(userBlocks.blockedId, viewerId)),
      ]);
      blockedIds = [...blockedRows.map(r => r.userId), ...blockerRows.map(r => r.userId)];
    }

    // Users always searched (email/phone fallback when no tsQuery)
    const usersResult = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        email: users.email,
        lastName: users.lastName,
        image: users.image,
        bio: users.bio,
        isTalentPerson: sql`${talentProfiles.id} IS NOT NULL`,
        talentCategory: talentProfiles.category,
      })
      .from(users)
      .leftJoin(talentProfiles, eq(talentProfiles.userId, users.id))
      .where(
        and(
          isNull(users.deletedAt),
          blockedIds.length > 0 ? notInArray(users.id, blockedIds) : undefined,
          tsQuery
            ? sql`(
          ${users.userSearch} @@ to_tsquery('simple', ${tsQuery})
          OR (${users.allowSearchByEmail} = true AND lower(${users.email}) LIKE lower(${likeQ}))
          OR (${users.allowSearchByPhone} = true AND ${users.phoneNumber} LIKE ${likeQ})
        )`
            : sql`(
          (${users.allowSearchByEmail} = true AND lower(${users.email}) LIKE lower(${likeQ}))
          OR (${users.allowSearchByPhone} = true AND ${users.phoneNumber} LIKE ${likeQ})
        )`
        )
      )
      .orderBy(
        tsQuery
          ? sql`ts_rank(${users.userSearch}, to_tsquery('simple', ${tsQuery})) DESC`
          : sql`${users.createdAt} DESC`
      )
      .limit(limit);

    // Events, groups, talents only make sense with a text query
    if (!tsQuery) {
      return {
        users: usersResult,
        events: [],
        groups: [],
        talents: [],
        meta: {
          query: q,
          totals: {
            users: usersResult.length,
            events: 0,
            groups: 0,
            talents: 0,
          },
        },
      };
    }

    const [eventsResult, groupsResult, talentsResult] = await Promise.all([
      db
        .select({
          id: events.id,
          title: events.title,
          slug: events.slug,
          coverImages: events.coverImages,
          startDate: events.startDate,
          eventType: events.eventType,
          eventMode: events.eventMode,
          isFree: events.isFree,
        })
        .from(events)
        .where(
          and(
            isNull(events.deletedAt),
            eq(events.eventStatus, 'published'),
            sql`${events.eventSearch} @@ to_tsquery('english', ${tsQuery})`
          )
        )
        .orderBy(sql`ts_rank(${events.eventSearch}, to_tsquery('english', ${tsQuery})) DESC`)
        .limit(limit),

      db
        .select({
          id: groups.id,
          name: groups.name,
          slug: groups.slug,
          coverImageUrl: groups.coverImageUrl,
          memberCount: groups.memberCount,
          city: groups.city,
          country: groups.country,
          isPublic: groups.isPublic,
        })
        .from(groups)
        .where(
          and(
            isNull(groups.deletedAt),
            sql`${groups.groupSearch} @@ to_tsquery('english', ${tsQuery})`
          )
        )
        .orderBy(sql`ts_rank(${groups.groupSearch}, to_tsquery('english', ${tsQuery})) DESC`)
        .limit(limit),

      db
        .select({
          profileId: talentProfiles.id,
          userId: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          image: users.image,
          category: talentProfiles.category,
          title: talentProfiles.title,
          bio: talentProfiles.bio,
          location: talentProfiles.location,
          isVerified: talentProfiles.isVerified,
          rating: talentProfiles.rating,
          reviewCount: talentProfiles.reviewCount,
        })
        .from(talentProfiles)
        .innerJoin(users, eq(users.id, talentProfiles.userId))
        .where(
          and(
            isNull(talentProfiles.deletedAt),
            eq(talentProfiles.isActive, true),
            isNull(users.deletedAt),
            blockedIds.length > 0 ? notInArray(users.id, blockedIds) : undefined,
            sql`${talentProfiles.talentSearch} @@ to_tsquery('simple', ${tsQuery})`
          )
        )
        .orderBy(
          sql`ts_rank(${talentProfiles.talentSearch}, to_tsquery('simple', ${tsQuery})) DESC`
        )
        .limit(limit),
    ]);

    return {
      users: usersResult,
      events: eventsResult,
      groups: groupsResult,
      talents: talentsResult,
      meta: {
        query: q,
        totals: {
          users: usersResult.length,
          events: eventsResult.length,
          groups: groupsResult.length,
          talents: talentsResult.length,
        },
      },
    };
  },
};
