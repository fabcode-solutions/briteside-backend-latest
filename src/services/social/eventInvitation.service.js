import { db } from '../../db/index.js';
import {
  users,
  eventInvitations,
  events,
  userFollows,
  followerInviteLog,
  eventBlasts,
} from '../../db/schema/index.js';
import { eq, and, desc, count } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { createNotification } from '../notification.service.js';
import { sendBulkTemplatedEmail } from '../bulkMail.service.js';

const FRONTEND_URL = process.env.FRONTEND_URL || '';
const NOTIFY_CHUNK = 50;
// Each event gets exactly one follower-notification send, ever — not a
// per-organizer/per-day throttle, so a second event isn't blocked by an
// unrelated event's earlier invite.
const INVITE_FOLLOWERS_LIMIT = 1;

/**
 * Event invitation service for managing event invitations
 */
export class EventInvitationService {
  /**
   * Invite users to an event
   * @param {string} eventId - The event's ID
   * @param {string} inviterId - The inviter's ID
   * @param {string[]} inviteeIds - Array of invitee user IDs
   */
  static async inviteToEvent(eventId, inviterId, inviteeIds) {
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      with: {
        organizer: true,
      },
    });

    if (!event) {
      throw new ApiError(404, 'Event not found');
    }

    // if (event.eventType !== 'private') {
    //   throw new ApiError(400, 'Can only invite to private events');
    // }

    // Fetch inviter details
    const inviter = await db.query.users.findFirst({
      where: eq(users.id, inviterId),
    });

    const invitations = inviteeIds.map(inviteeId => ({
      eventId,
      inviterId,
      inviteeId,
    }));

    const created = await db
      .insert(eventInvitations)
      .values(invitations)
      .onConflictDoNothing()
      .returning();

    // Return invitations along with event and inviter details for notifications
    return {
      invitations: created,
      event: {
        id: event.id,
        title: event.title,
        eventCode: event.eventCode,
      },
      inviter: {
        id: inviter?.id,
        username: inviter?.username || 'Someone',
        fullName: inviter?.fullName,
      },
    };
  }

  /**
   * Get invitations for a user
   * @param {string} userId - The user's ID
   * @param {string|null} status - Optional status filter
   */
  static async getUserInvitations(userId, status = null) {
    let whereClause = eq(eventInvitations.inviteeId, userId);

    if (status) {
      whereClause = and(whereClause, eq(eventInvitations.status, status));
    }

    const invitations = await db.query.eventInvitations.findMany({
      where: whereClause,
      with: {
        event: {
          with: {
            organizer: true,
            venue: true,
          },
        },
        inviter: true,
        invitee: true,
      },
      orderBy: desc(eventInvitations.invitedAt),
    });

    return invitations;
  }

  /**
   * Respond to an invitation
   * @param {string} invitationId - The invitation's ID
   * @param {string} userId - The user's ID
   * @param {string} status - Response status
   */
  static async respondToInvitation(invitationId, userId, status) {
    const [updated] = await db
      .update(eventInvitations)
      .set({ status, respondedAt: new Date() })
      .where(and(eq(eventInvitations.id, invitationId), eq(eventInvitations.inviteeId, userId)))
      .returning();

    if (!updated) {
      throw new ApiError(404, 'Invitation not found');
    }

    return updated;
  }

  static async inviteAllFollowers(eventId, organizerUserId, organizerId) {
    // Fetch event with venue + organizer for email template
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      with: { venue: true, organizer: true },
    });
    if (!event) throw new ApiError(404, 'Event not found');
    if (event.organizerId !== organizerId) throw new ApiError(403, 'Not your event');

    // Rate limit: once per event — scoped to eventId, not organizerId, so
    // sending for one event never blocks a different event.
    const [eventCount] = await db
      .select({ count: count() })
      .from(followerInviteLog)
      .where(eq(followerInviteLog.eventId, eventId));

    if (eventCount.count >= INVITE_FOLLOWERS_LIMIT) {
      throw new ApiError(429, 'Followers have already been notified for this event');
    }

    // Fetch all followers with email + name for notifications + emails
    const followers = await db
      .select({
        followerId: userFollows.followerId,
        email: users.email,
        firstName: users.firstName,
      })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followerId))
      .where(eq(userFollows.followingId, organizerUserId));

    if (followers.length === 0) {
      await db.insert(followerInviteLog).values({ organizerId, eventId });
      await db.insert(eventBlasts).values({
        eventId,
        sentBy: organizerUserId,
        type: 'followers',
        message: 'Notified all followers about this event',
        recipientCount: 0,
        successCount: 0,
        failureCount: 0,
        status: 'completed',
      });
      return { invited: 0, emailsSent: 0 };
    }

    // Bulk insert invitations — skip duplicates
    const invitationRows = followers.map(f => ({
      eventId,
      inviterId: organizerUserId,
      inviteeId: f.followerId,
    }));
    const created = await db
      .insert(eventInvitations)
      .values(invitationRows)
      .onConflictDoNothing()
      .returning();

    // Send in-app notifications in chunks
    const organizerName = event.organizer?.businessName || 'Someone';
    for (let i = 0; i < created.length; i += NOTIFY_CHUNK) {
      await Promise.allSettled(
        created.slice(i, i + NOTIFY_CHUNK).map(inv =>
          createNotification({
            userId: inv.inviteeId,
            title: 'Event Invitation',
            message: `${organizerName} invited you to ${event.title}`,
            type: 'event_update',
            relatedId: eventId,
            redirectTo: `/events/${event.slug}`,
            metadata: {
              eventId,
              eventTitle: event.title,
              inviterId: organizerUserId,
              invitationId: inv.id,
              organizerLogoUrl: event.organizer?.logoUrl ?? null,
            },
          })
        )
      );
    }

    // Send bulk emails via SES template
    const eventDate = new Date(event.startDate).toLocaleString();
    const eventLocation = event.venue
      ? [event.venue.name, event.venue.city, event.venue.state].filter(Boolean).join(', ')
      : 'See event details';
    const inviteUrl = `${FRONTEND_URL}/events/${event.slug}`;

    const defaultData = {
      user_name: 'there',
      event_name: event.title,
      event_date: eventDate,
      event_location: eventLocation,
      organizer_name: organizerName,
      invite_url: inviteUrl,
    };

    const emailRecipients = followers
      .filter(f => f.email)
      .map(f => ({
        email: f.email,
        data: { ...defaultData, user_name: f.firstName || 'there' },
      }));

    let emailsSent = 0;
    if (emailRecipients.length > 0) {
      const emailResult = await sendBulkTemplatedEmail(
        'Briteside-event-invite',
        defaultData,
        emailRecipients
      );
      emailsSent = emailResult.sent;
    }

    // Log this action for rate limiting
    await db.insert(followerInviteLog).values({ organizerId, eventId });

    // Also show up in Blast History alongside SMS/email blasts, so an
    // organizer sees every outbound communication for the event in one place.
    await db.insert(eventBlasts).values({
      eventId,
      sentBy: organizerUserId,
      type: 'followers',
      message: 'Notified all followers about this event',
      recipientCount: followers.length,
      successCount: emailsSent,
      failureCount: Math.max(0, emailRecipients.length - emailsSent),
      status: 'completed',
    });

    return { invited: created.length, emailsSent };
  }

  /** Real server-side usage for the "notify followers" badge — mirrors
   *  BlastService.getBlastStats (event_blasts grouped by eventId). */
  static async getInviteFollowersStats(eventId) {
    const [row] = await db
      .select({ count: count() })
      .from(followerInviteLog)
      .where(eq(followerInviteLog.eventId, eventId));

    return { used: row.count, limit: INVITE_FOLLOWERS_LIMIT };
  }
}
