import { db } from '../db/index.js';
import { events, purchasedTickets, eventMerchandise, users } from '../db/schema/index.js';
import { eq, and, gte, lte, sql, count, desc, asc } from 'drizzle-orm';
import { cronLogger as logger } from '../config/logger.js';
import { createNotification } from '../services/notification.service.js';
import {
  sendEventReminderEmail,
  sendMerchandiseUpsellEmail,
  sendPromotionalEmail,
} from '../services/eventMail.helper.js';

/**
 * Create notification reminder for an event
 * @param {Object} event - Event object
 * @param {string} userId - User ID
 * @param {number} hoursBefore - Hours before event
 */
const createEventReminderNotification = async (event, userId, hoursBefore) => {
  const reminderType = hoursBefore === 24 ? '24-hour' : '1-hour';
  const message = `${event.title} starts in ${reminderType}. Don't miss it!`;

  try {
    await createNotification({
      userId,
      type: 'event_reminder',
      title: 'Event Reminder',
      message,
      data: {
        eventId: event.id,
        eventTitle: event.title,
        eventStartDate: event.startDate,
        hoursBefore,
      },
      metadata: { eventId: event.id, eventTitle: event.title },
    });
    logger.info('[Cron] Event reminder notification created', { userId, eventTitle: event.title });
  } catch (error) {
    logger.error('[Cron] Event reminder notification failed', {
      userId,
      error: error.message,
      stack: error.stack,
    });
  }
};

/**
 * Create special notification for bulk ticket purchases
 * @param {Object} event - Event object
 * @param {Object} user - User object
 * @param {number} ticketCount - Number of tickets purchased
 */
const createBulkPurchaseNotification = async (event, user, ticketCount) => {
  const message = `Thank you for purchasing ${ticketCount} tickets for ${event.title}! As a valued bulk purchaser, you may be eligible for special perks.`;

  try {
    await createNotification({
      userId: user.id,
      type: 'bulk_purchase',
      title: 'VIP Bulk Purchase Acknowledgment',
      message,
      data: {
        eventId: event.id,
        eventTitle: event.title,
        ticketCount,
        vipStatus: true,
      },
      metadata: { eventId: event.id, eventTitle: event.title, ticketCount },
    });
    logger.info('[Cron] Bulk purchase notification sent', { userId: user.id, ticketCount });
  } catch (error) {
    logger.error('[Cron] Bulk purchase notification failed', {
      userId: user.id,
      error: error.message,
      stack: error.stack,
    });
  }
};

/**
 * Process reminders for upcoming events
 * @param {number} hoursBefore - Hours before event to send reminder
 */
export const processEventReminders = async hoursBefore => {
  logger.info('[Cron] Processing event reminders', { hoursBefore });

  try {
    // Calculate the time window for events
    const now = new Date();
    const futureTime = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);

    // We want events starting within the next `hoursBefore` hours.
    // Previously this code matched events starting between `futureTime` and
    // `futureTime + buffer`, which only caught events that start roughly exactly
    // `hoursBefore` hours from now. That caused many events within the next
    // 24 hours to be missed. Use a window from `now` -> `futureTime` instead.
    const windowStart = now;
    const windowEnd = futureTime;

    // Find events starting within the time window (now .. futureTime)
    const upcomingEvents = await db.query.events.findMany({
      where: and(
        gte(events.startDate, windowStart),
        lte(events.startDate, windowEnd),
        eq(events.eventStatus, 'published'), // Only published events
        sql`${events.deletedAt} IS NULL` // Not deleted
      ),
      with: {
        venue: true,
        organizer: true,
      },
    });

    logger.info('[Cron] Upcoming events found', { count: upcomingEvents.length, hoursBefore });

    for (const event of upcomingEvents) {
      // Find all purchased tickets for this event
      const tickets = await db.query.purchasedTickets.findMany({
        where: and(
          eq(purchasedTickets.eventId, event.id),
          eq(purchasedTickets.status, 'active') // Only active tickets
        ),
        with: {
          user: true,
        },
      });

      logger.info('[Cron] Active tickets found for event', {
        count: tickets.length,
        eventTitle: event.title,
      });

      // Check for available merchandise for this event
      const availableMerchandise = await db.query.eventMerchandise.findMany({
        where: and(
          eq(eventMerchandise.eventId, event.id),
          gte(eventMerchandise.quantityAvailable, 1) // Only items with stock
        ),
        orderBy: [desc(eventMerchandise.createdAt)],
      });

      logger.info('[Cron] Merchandise items found for event', {
        count: availableMerchandise.length,
        eventTitle: event.title,
      });

      // Group tickets by user to handle bulk purchases
      const userTickets = {};
      tickets.forEach(ticket => {
        if (ticket.user && ticket.user.email) {
          if (!userTickets[ticket.user.id]) {
            userTickets[ticket.user.id] = {
              user: ticket.user,
              tickets: [],
            };
          }
          userTickets[ticket.user.id].tickets.push(ticket);
        }
      });

      // Send reminders to each unique user
      for (const [userId, userData] of Object.entries(userTickets)) {
        const { user, tickets: userTicketList } = userData;
        const ticketCount = userTicketList.length;

        // Send event reminder (email and notification)
        await sendEventReminderEmail(event, user, hoursBefore);
        await createEventReminderNotification(event, user.id, hoursBefore);

        // Send merchandise upsell if merchandise exists and user has tickets
        if (availableMerchandise.length > 0) {
          await sendMerchandiseUpsellEmail(event, user, availableMerchandise, ticketCount);
        }

        // Special handling for bulk ticket purchases (10+ tickets)
        if (ticketCount >= 10) {
          logger.info('[Cron] Bulk purchase detected', {
            userId: user.id,
            ticketCount,
            eventTitle: event.title,
          });
          await createBulkPurchaseNotification(event, user, ticketCount);
        }
      }
    }

    logger.info('[Cron] Event reminders complete', { hoursBefore });
  } catch (error) {
    logger.error('[Cron] Event reminders failed', {
      hoursBefore,
      error: error.message,
      stack: error.stack,
    });
  }
};

/**
 * Send promotional emails to users who haven't bought tickets for upcoming events
 */
export const sendPromotionalEmailsToNonAttendees = async () => {
  logger.info('[Cron] Sending promotional emails to non-attendees');

  try {
    // Find upcoming events in the next 7 days
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcomingEvents = await db.query.events.findMany({
      where: and(
        gte(events.startDate, now),
        lte(events.startDate, weekFromNow),
        eq(events.eventStatus, 'published'),
        sql`${events.deletedAt} IS NULL`
      ),
      with: {
        venue: true,
        category: true,
      },
      limit: 5, // Limit to top 5 upcoming events
      orderBy: [asc(events.startDate)],
    });

    if (upcomingEvents.length === 0) {
      logger.info('[Cron] No upcoming events found for promotion');
      return;
    }

    // Get all users
    const allUsers = await db.query.users.findMany({
      where: sql`${users.deletedAt} IS NULL`,
      limit: 1000, // Limit to prevent overwhelming emails
    });

    logger.info('[Cron] Promotional email targets found', {
      eventCount: upcomingEvents.length,
      userCount: allUsers.length,
    });

    // For each user, check if they have tickets for any upcoming events
    // NOTE: Avoid constructing an SQL `IN` clause by interpolating a single
    // string of comma-separated ids (that becomes one parameter). That was
    // causing a Drizzle/pg UUID parse error when the driver tried to parse the
    // whole string as a single UUID. Instead, check per-event using
    // parameterized queries (safe) — upcomingEvents is limited (limit:5)
    for (const user of allUsers) {
      if (!user.email) continue;

      let hasTicket = false;

      for (const ev of upcomingEvents) {
        const found = await db.query.purchasedTickets.findFirst({
          where: and(
            eq(purchasedTickets.userId, user.id),
            eq(purchasedTickets.status, 'active'),
            eq(purchasedTickets.eventId, ev.id)
          ),
        });

        if (found) {
          hasTicket = true;
          break;
        }
      }

      // If user doesn't have tickets, send promotional email
      if (!hasTicket) {
        await sendPromotionalEmail(user, upcomingEvents);
      }
    }

    logger.info('[Cron] Promotional emails complete');
  } catch (error) {
    logger.error('[Cron] Promotional emails failed', { error: error.message, stack: error.stack });
  }
};

export default {
  processEventReminders,
  sendPromotionalEmailsToNonAttendees,
};
