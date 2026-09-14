import { db } from '../db/index.js';
import { eventLikes, events } from '../db/schema/index.js';
import { eq, and, count } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';

export class EventLikeService {
  static async toggleLike(userId, eventId) {
    try {
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
      });

      if (!event) throw new ApiError(404, 'Event not found');

      const existingLike = await db.query.eventLikes.findFirst({
        where: and(eq(eventLikes.eventId, eventId), eq(eventLikes.userId, userId)),
      });

      let isLiked;
      let likeCount;

      if (existingLike) {
        await db
          .delete(eventLikes)
          .where(and(eq(eventLikes.eventId, eventId), eq(eventLikes.userId, userId)));

        const [updatedEvent] = await db
          .update(events)
          .set({ likeCount: Math.max(0, (event.likeCount || 0) - 1), updatedAt: new Date() })
          .where(eq(events.id, eventId))
          .returning();

        isLiked = false;
        likeCount = updatedEvent.likeCount;
      } else {
        await db.insert(eventLikes).values({ eventId, userId, createdAt: new Date() });

        const [updatedEvent] = await db
          .update(events)
          .set({ likeCount: (event.likeCount || 0) + 1, updatedAt: new Date() })
          .where(eq(events.id, eventId))
          .returning();

        isLiked = true;
        likeCount = updatedEvent.likeCount;
      }

      return {
        isLiked,
        // Return null if organizer disabled like count visibility
        likeCount: event.showLikeCount ? likeCount : null,
        showLikeCount: event.showLikeCount,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Toggle like error:', error);
      throw new ApiError(500, 'Failed to toggle like');
    }
  }

  static async getUserLikeStatus(userId, eventId) {
    try {
      const existingLike = await db.query.eventLikes.findFirst({
        where: and(eq(eventLikes.eventId, eventId), eq(eventLikes.userId, userId)),
      });

      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { likeCount: true, showLikeCount: true },
      });

      return {
        isLiked: !!existingLike,
        likeCount: event?.showLikeCount ? event?.likeCount || 0 : null,
        showLikeCount: event?.showLikeCount ?? true,
      };
    } catch (error) {
      console.error('Get user like status error:', error);
      throw new ApiError(500, 'Failed to get like status');
    }
  }

  static async getUserLikeStatus(userId, eventId) {
    try {
      const existingLike = await db.query.eventLikes.findFirst({
        where: and(eq(eventLikes.eventId, eventId), eq(eventLikes.userId, userId)),
      });

      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: { likeCount: true },
      });

      return {
        isLiked: !!existingLike,
        likeCount: event?.likeCount || 0,
      };
    } catch (error) {
      console.error('Get user like status error:', error);
      throw new ApiError(500, 'Failed to get like status');
    }
  }

  static async getEventLikeCount(eventId) {
    try {
      const [result] = await db
        .select({ count: count() })
        .from(eventLikes)
        .where(eq(eventLikes.eventId, eventId));

      return result.count;
    } catch (error) {
      console.error('Get event like count error:', error);
      throw new ApiError(500, 'Failed to get like count');
    }
  }

  static async getUserLikedEventIds(userId) {
    try {
      const likes = await db.query.eventLikes.findMany({
        where: eq(eventLikes.userId, userId),
        columns: { eventId: true },
      });
      return likes.map(l => l.eventId);
    } catch (error) {
      console.error('Get user liked event ids error:', error);
      throw new ApiError(500, 'Failed to fetch liked events');
    }
  }
}
