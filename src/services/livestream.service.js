import { db } from '../db/index.js';
import {
  livestreams,
  livestreamReactions,
  livestreamComments,
  livestreamViewers,
  userFollows,
  users,
} from '../db/schema/index.js';
import { eq, and, desc, sql, count, ne } from 'drizzle-orm';
import { StreamClient } from '@stream-io/node-sdk';
import { createNotification } from './notification.service.js';
import ApiError from '../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';

const streamClient = new StreamClient(process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET);

// ─── STREAM CALL TYPE ────────────────────────────────────────────────────────
// GetStream uses "livestream" as the built-in call type for one-to-many broadcasts.
const LIVESTREAM_CALL_TYPE = 'livestream';

export class LivestreamService {
  // ─────────────────────────────────────────────────────────────────────────
  // START a live stream
  // 1. Create a GetStream "livestream" call
  // 2. Insert a DB record
  // 3. Notify all followers (non-blocking)
  // ─────────────────────────────────────────────────────────────────────────
  static async startLivestream({ userId, title, description, allowComments }) {
    // Prevent a user from having two concurrent streams
    const existing = await db.query.livestreams.findFirst({
      where: and(eq(livestreams.userId, userId), eq(livestreams.status, 'live')),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
      },
    });
    if (existing) {
      // Return current active livestream instead of failing
      return {
        stream: existing,
        callId: existing.streamCallId,
        callType: LIVESTREAM_CALL_TYPE,
        alreadyLive: true,
      };
    }

    // Create the call in GetStream
    const callId = `live_${userId}_${Date.now()}`;
    const call = streamClient.video.call(LIVESTREAM_CALL_TYPE, callId);

    await call.getOrCreate({
      data: {
        created_by_id: userId,
        custom: { title, description },
        // Disable backstage so the stream is publicly joinable immediately.
        // Must live under settings_override — a top-level `backstage` key is ignored,
        // leaving the call-type default (backstage ON), which blocks non-host joins
        // with "not allowed to perform action JoinBackstage".
        settings_override: {
          backstage: {
            enabled: false,
          },
        },
      },
    });

    const streamModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.LIVESTREAM,
      entityCreatorId: userId,
      texts: [title, description],
    });

    // Persist to DB
    const [inserted] = await db
      .insert(livestreams)
      .values({
        userId,
        title,
        description: description || null,
        streamCallId: callId,
        streamCallCid: `${LIVESTREAM_CALL_TYPE}:${callId}`,
        status: 'live',
        allowComments: allowComments !== false,
        startedAt: new Date(),
      })
      .returning();

    await TextModerationService.recordIfFlagged(streamModeration, {
      entityType: TEXT_ENTITY.LIVESTREAM,
      entityId: inserted.id,
      userId,
      fieldNames: ['title', 'description'],
      texts: [title, description],
    });

    // Notify followers (fire-and-forget)
    LivestreamService._notifyFollowers(userId, inserted.id, title).catch(err =>
      console.warn('[livestream] follower notification failed:', err)
    );

    // Re-fetch with the user relation so the 'livestream:started' socket payload
    // matches the /livestream/active shape — the sidebar needs stream.user.
    const stream = await LivestreamService.getLivestream(inserted.id);

    return { stream, callId, callType: LIVESTREAM_CALL_TYPE };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // END a live stream
  // ─────────────────────────────────────────────────────────────────────────
  static async endLivestream({ livestreamId, userId }) {
    const stream = await db.query.livestreams.findFirst({
      where: eq(livestreams.id, livestreamId),
    });
    if (!stream) throw new ApiError(404, 'Livestream not found.');
    if (stream.userId !== userId) throw new ApiError(403, 'Not authorised.');
    // Idempotent: the GetStream webhook (triggered by the client's endCall()) often
    // wins the race and marks the stream ended before this endpoint runs. Return the
    // already-ended row instead of throwing so the manual /end path never 400s.
    if (stream.status === 'ended') return stream;

    // End call in GetStream (best-effort)
    try {
      const call = streamClient.video.call(LIVESTREAM_CALL_TYPE, stream.streamCallId);
      await call.end();
    } catch (err) {
      console.warn('[livestream] GetStream call end failed:', err.message);
    }

    const [updated] = await db
      .update(livestreams)
      .set({ status: 'ended', endedAt: new Date(), updatedAt: new Date() })
      .where(eq(livestreams.id, livestreamId))
      .returning();

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK HELPERS — driven by GetStream call events (see webhook.controller)
  // ─────────────────────────────────────────────────────────────────────────

  // Look up a livestream by its GetStream call id (unique).
  static async getByCallId(streamCallId) {
    return db.query.livestreams.findFirst({
      where: eq(livestreams.streamCallId, streamCallId),
    });
  }

  // Mark a livestream ended (idempotent — skips rows already 'ended').
  static async markEndedByCallId(streamCallId) {
    const [updated] = await db
      .update(livestreams)
      .set({ status: 'ended', endedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(livestreams.streamCallId, streamCallId), ne(livestreams.status, 'ended')))
      .returning();
    return updated ?? null;
  }

  // Host left → terminate the GetStream call (kicks viewers, stops billing) then mark ended.
  static async forceEndByCallId(streamCallId) {
    try {
      const call = streamClient.video.call(LIVESTREAM_CALL_TYPE, streamCallId);
      await call.end();
    } catch (err) {
      console.warn('[livestream] webhook force-end call.end failed:', err.message);
    }
    return LivestreamService.markEndedByCallId(streamCallId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET a single livestream (with host info)
  // ─────────────────────────────────────────────────────────────────────────
  static async getLivestream(livestreamId, viewerId) {
    const stream = await db.query.livestreams.findFirst({
      where: eq(livestreams.id, livestreamId),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
      },
    });
    if (!stream) throw new ApiError(404, 'Livestream not found.');

    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    return TextModerationService.maskFlaggedTextSingle(stream, {
      entityType: TEXT_ENTITY.LIVESTREAM,
      fields: ['title', 'description'],
      filterEnabled,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET all currently LIVE streams (for Spotlight in social tab)
  // ─────────────────────────────────────────────────────────────────────────
  static async getActiveLivestreams({ page = 1, limit = 20, viewerId } = {}) {
    const offset = (page - 1) * limit;

    const rows = await db.query.livestreams.findMany({
      where: eq(livestreams.status, 'live'),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
      },
      orderBy: [desc(livestreams.viewerCount), desc(livestreams.startedAt)],
      limit,
      offset,
    });

    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    return TextModerationService.maskFlaggedText(rows, {
      entityType: TEXT_ENTITY.LIVESTREAM,
      fields: ['title', 'description'],
      filterEnabled,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Get livestreams of users that the viewer follows (personalised spotlight)
  // ─────────────────────────────────────────────────────────────────────────
  static async getFollowingLivestreams(viewerId) {
    // Get list of user IDs the viewer follows
    const following = await db.query.userFollows.findMany({
      where: eq(userFollows.followerId, viewerId),
      columns: { followingId: true },
    });
    const followingIds = following.map(f => f.followingId);
    if (followingIds.length === 0) return [];

    const rows = await db.query.livestreams.findMany({
      where: and(
        eq(livestreams.status, 'live'),
        sql`${livestreams.userId} = ANY(${sql.raw(`ARRAY[${followingIds.map(id => `'${id}'`).join(',')}]::uuid[]`)})`
      ),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
      },
      orderBy: [desc(livestreams.startedAt)],
    });

    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    return TextModerationService.maskFlaggedText(rows, {
      entityType: TEXT_ENTITY.LIVESTREAM,
      fields: ['title', 'description'],
      filterEnabled,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // JOIN – track viewer joining (upsert) & increment count
  // ─────────────────────────────────────────────────────────────────────────
  static async joinLivestream({ livestreamId, userId }) {
    const stream = await db.query.livestreams.findFirst({
      where: eq(livestreams.id, livestreamId),
    });
    if (!stream) throw new ApiError(404, 'Livestream not found.');
    if (stream.status !== 'live') throw new ApiError(400, 'This stream is not live.');

    // Upsert viewer record
    await db.insert(livestreamViewers).values({ livestreamId, userId }).onConflictDoNothing();

    // Increment viewer count
    const [updated] = await db
      .update(livestreams)
      .set({
        viewerCount: sql`${livestreams.viewerCount} + 1`,
        peakViewerCount: sql`GREATEST(${livestreams.peakViewerCount}, ${livestreams.viewerCount} + 1)`,
        updatedAt: new Date(),
      })
      .where(eq(livestreams.id, livestreamId))
      .returning({ viewerCount: livestreams.viewerCount });

    return { viewerCount: updated.viewerCount };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LEAVE – mark viewer as left & decrement count
  // ─────────────────────────────────────────────────────────────────────────
  static async leaveLivestream({ livestreamId, userId }) {
    await db
      .update(livestreamViewers)
      .set({ leftAt: new Date() })
      .where(
        and(eq(livestreamViewers.livestreamId, livestreamId), eq(livestreamViewers.userId, userId))
      );

    await db
      .update(livestreams)
      .set({
        viewerCount: sql`GREATEST(0, ${livestreams.viewerCount} - 1)`,
        updatedAt: new Date(),
      })
      .where(eq(livestreams.id, livestreamId));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REACT (Instagram-style emoji burst)
  // ─────────────────────────────────────────────────────────────────────────
  static async addReaction({ livestreamId, userId, emoji }) {
    const ALLOWED_EMOJIS = ['❤️', '🔥', '👏', '😮', '😂', '🎉'];
    if (!ALLOWED_EMOJIS.includes(emoji)) {
      throw new ApiError(400, `Emoji must be one of: ${ALLOWED_EMOJIS.join(', ')}`);
    }

    const stream = await db.query.livestreams.findFirst({
      where: eq(livestreams.id, livestreamId),
    });
    if (!stream) throw new ApiError(404, 'Livestream not found.');
    if (stream.status !== 'live') throw new ApiError(400, 'Stream is not live.');

    const [reaction] = await db
      .insert(livestreamReactions)
      .values({ livestreamId, userId, emoji })
      .returning();

    // Increment total reaction counter (denormalised)
    await db
      .update(livestreams)
      .set({ totalReactions: sql`${livestreams.totalReactions} + 1`, updatedAt: new Date() })
      .where(eq(livestreams.id, livestreamId));

    return reaction;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADD COMMENT
  // ─────────────────────────────────────────────────────────────────────────
  static async addComment({ livestreamId, userId, text }) {
    const stream = await db.query.livestreams.findFirst({
      where: eq(livestreams.id, livestreamId),
    });
    if (!stream) throw new ApiError(404, 'Livestream not found.');
    if (stream.status !== 'live') throw new ApiError(400, 'Stream is not live.');
    if (!stream.allowComments) throw new ApiError(403, 'Comments are disabled for this stream.');
    if (!text?.trim()) throw new ApiError(400, 'Comment text cannot be empty.');

    const commentModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.LIVESTREAM,
      entityCreatorId: userId,
      texts: [text],
    });

    const [comment] = await db
      .insert(livestreamComments)
      .values({ livestreamId, userId, text: text.trim() })
      .returning();

    await TextModerationService.recordIfFlagged(commentModeration, {
      entityType: TEXT_ENTITY.LIVESTREAM,
      entityId: comment.id,
      userId,
      fieldNames: ['text'],
      texts: [text],
    });

    // Join user details
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, username: true, firstName: true, lastName: true, image: true },
    });

    return { ...comment, user };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET COMMENTS (paginated, newest first)
  // ─────────────────────────────────────────────────────────────────────────
  static async getComments({ livestreamId, page = 1, limit = 50, viewerId }) {
    const offset = (page - 1) * limit;

    const rows = await db.query.livestreamComments.findMany({
      where: and(
        eq(livestreamComments.livestreamId, livestreamId),
        eq(livestreamComments.isDeleted, false)
      ),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
      },
      orderBy: [desc(livestreamComments.createdAt)],
      limit,
      offset,
    });

    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    return TextModerationService.maskFlaggedText(rows, {
      entityType: TEXT_ENTITY.LIVESTREAM,
      fields: ['text'],
      filterEnabled,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE COMMENT (owner or stream host)
  // ─────────────────────────────────────────────────────────────────────────
  static async deleteComment({ commentId, requesterId }) {
    const comment = await db.query.livestreamComments.findFirst({
      where: eq(livestreamComments.id, commentId),
      with: { livestream: { columns: { userId: true } } },
    });
    if (!comment) throw new ApiError(404, 'Comment not found.');

    const isOwner = comment.userId === requesterId;
    const isHost = comment.livestream?.userId === requesterId;
    if (!isOwner && !isHost) throw new ApiError(403, 'Not authorised.');

    await db
      .update(livestreamComments)
      .set({ isDeleted: true })
      .where(eq(livestreamComments.id, commentId));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET REACTION SUMMARY (counts per emoji)
  // ─────────────────────────────────────────────────────────────────────────
  static async getReactionSummary(livestreamId) {
    const rows = await db
      .select({
        emoji: livestreamReactions.emoji,
        total: count(livestreamReactions.id),
      })
      .from(livestreamReactions)
      .where(eq(livestreamReactions.livestreamId, livestreamId))
      .groupBy(livestreamReactions.emoji);

    return rows;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Generate Stream token (reuse existing token logic for livestream type)
  // ─────────────────────────────────────────────────────────────────────────
  // static async generateToken(userId) {
  //   const validity = 6 * 60 * 60; // 6 hours
  //   return streamClient.generateUserToken({
  //     user_id: userId,
  //     validity_in_seconds: validity,
  //   });
  // }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: Notify all followers that this user went live
  // ─────────────────────────────────────────────────────────────────────────
  static async _notifyFollowers(userId, livestreamId, title) {
    // Get broadcaster's display name
    const broadcaster = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, username: true, firstName: true, lastName: true },
    });
    const name =
      broadcaster?.username ||
      `${broadcaster?.firstName} ${broadcaster?.lastName}`.trim() ||
      'Someone';

    // Get all follower user IDs
    const followers = await db.query.userFollows.findMany({
      where: eq(userFollows.followingId, userId),
      columns: { followerId: true },
    });

    if (followers.length === 0) return;

    // Send notifications in parallel (batch of 50 to avoid hammering DB)
    const BATCH = 50;
    for (let i = 0; i < followers.length; i += BATCH) {
      const batch = followers.slice(i, i + BATCH);
      await Promise.allSettled(
        batch.map(f =>
          createNotification({
            userId: f.followerId,
            title: `${name} is Live 🔴`,
            message: `${name} just started a live stream: "${title}"`,
            type: 'social_update',
            relatedId: livestreamId,
            redirectTo: `/live/${livestreamId}`,
            metadata: { livestreamId, broadcasterId: userId },
          })
        )
      );
    }
  }
}
