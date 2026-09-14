import { db } from '../db/index.js';
import { events, eventSchedules, purchasedTickets } from '../db/schema/index.js';
import { eq, and, isNull, sql } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { calculateEventDateRange } from '../utils/event-helpers.js';

export class EventScheduleService {
  /**
   * Update an existing event schedule
   * @param {string} scheduleId - Schedule ID
   * @param {Object} updateData - Update data
   * @returns {Promise<Object>} - Updated schedule
   */
  static async updateSchedule(scheduleId, updateData) {
    const { title, description, date, startTime, endTime } = updateData;

    // Fetch existing schedule
    const existingSchedule = await db.query.eventSchedules.findFirst({
      where: and(eq(eventSchedules.id, scheduleId), isNull(eventSchedules.deletedAt)),
    });

    if (!existingSchedule) {
      throw new ApiError(404, 'Schedule not found');
    }

    // Prepare update object
    const updates = {
      updatedAt: new Date(),
    };

    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (date !== undefined) updates.date = new Date(date);

    // Validate and update times
    if (startTime || endTime) {
      const start = startTime ? new Date(startTime) : existingSchedule.startTime;
      const end = endTime ? new Date(endTime) : existingSchedule.endTime;

      if (end <= start) {
        throw new ApiError(400, 'End time must be after start time');
      }

      // Calculate new duration
      const duration = Math.floor((end - start) / (1000 * 60));

      // Check for overlapping schedules (excluding current schedule)
      const overlapping = await db.query.eventSchedules.findFirst({
        where: and(
          eq(eventSchedules.eventId, existingSchedule.eventId),
          sql`${eventSchedules.id} != ${scheduleId}`,
          isNull(eventSchedules.deletedAt),
          sql`${eventSchedules.startTime} < ${end.toISOString()} AND ${eventSchedules.endTime} > ${start.toISOString()}`
        ),
      });

      if (overlapping) {
        throw new ApiError(
          400,
          'Updated schedule overlaps with another session. Please choose different times.'
        );
      }

      updates.startTime = start;
      updates.endTime = end;
      updates.duration = duration;
    }

    // Update schedule
    const [updated] = await db
      .update(eventSchedules)
      .set(updates)
      .where(eq(eventSchedules.id, scheduleId))
      .returning();

    // Recalculate event date range and update parent event
    const allSchedules = await db.query.eventSchedules.findMany({
      where: and(
        eq(eventSchedules.eventId, existingSchedule.eventId),
        isNull(eventSchedules.deletedAt)
      ),
      orderBy: [eventSchedules.date, eventSchedules.startTime],
    });

    const { startDate: newStart, endDate: newEnd } = calculateEventDateRange(allSchedules);

    await db
      .update(events)
      .set({
        startDate: newStart,
        endDate: newEnd,
        updatedAt: new Date(),
      })
      .where(eq(events.id, existingSchedule.eventId));

    return updated;
  }

  /**
   * Delete an event schedule (soft delete)
   * @param {string} scheduleId - Schedule ID
   * @returns {Promise<Object>} - Deleted schedule
   */
  static async deleteSchedule(scheduleId) {
    // Fetch schedule
    const schedule = await db.query.eventSchedules.findFirst({
      where: and(eq(eventSchedules.id, scheduleId), isNull(eventSchedules.deletedAt)),
    });

    if (!schedule) {
      throw new ApiError(404, 'Schedule not found');
    }

    // Check if tickets have been sold
    if (schedule.ticketsSold > 0) {
      throw new ApiError(
        400,
        `Cannot delete schedule with ${schedule.ticketsSold} sold tickets. Please contact support if needed.`
      );
    }

    // Soft delete
    const [deleted] = await db
      .update(eventSchedules)
      .set({ deletedAt: new Date() })
      .where(eq(eventSchedules.id, scheduleId))
      .returning();

    // Recalculate event date range and update parent event
    const remainingSchedules = await db.query.eventSchedules.findMany({
      where: and(eq(eventSchedules.eventId, schedule.eventId), isNull(eventSchedules.deletedAt)),
      orderBy: [eventSchedules.date, eventSchedules.startTime],
    });

    const { startDate: newStart, endDate: newEnd } = calculateEventDateRange(remainingSchedules);

    await db
      .update(events)
      .set({
        startDate: newStart,
        endDate: newEnd,
        updatedAt: new Date(),
      })
      .where(eq(events.id, schedule.eventId));

    return deleted;
  }

  /**
   * Get all schedules for an event
   * @param {string} eventId - Event ID
   * @returns {Promise<Array>} - Array of schedules with availability info
   */
  static async getSchedulesByEventId(eventId) {
    // Verify event exists
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: {
        id: true,
        capacity: true,
        title: true,
      },
    });

    if (!event) {
      throw new ApiError(404, 'Event not found');
    }

    // Fetch all non-deleted schedules
    const schedules = await db.query.eventSchedules.findMany({
      where: and(eq(eventSchedules.eventId, eventId), isNull(eventSchedules.deletedAt)),
      orderBy: [eventSchedules.date, eventSchedules.startTime],
    });

    // Calculate availability for each schedule
    const schedulesWithAvailability = schedules.map(schedule => ({
      ...schedule,
      // availableTickets: event.capacity ? event.capacity - schedule.ticketsSold : null,
      eventCapacity: event.capacity,
      isSoldOut: event.capacity ? schedule.ticketsSold >= event.capacity : false,
    }));

    return schedulesWithAvailability;
  }

  /**
   * Get a single schedule by ID
   * @param {string} scheduleId - Schedule ID
   * @returns {Promise<Object>} - Schedule with availability info
   */
  static async getScheduleById(scheduleId) {
    const schedule = await db.query.eventSchedules.findFirst({
      where: and(eq(eventSchedules.id, scheduleId), isNull(eventSchedules.deletedAt)),
      with: {
        event: {
          columns: {
            id: true,
            title: true,
            capacity: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new ApiError(404, 'Schedule not found');
    }

    // Calculate availability
    const availableTickets = schedule.event.capacity
      ? schedule.event.capacity - schedule.ticketsSold
      : null;

    return {
      ...schedule,
      availableTickets,
      eventCapacity: schedule.event.capacity,
      isSoldOut: schedule.event.capacity ? schedule.ticketsSold >= schedule.event.capacity : false,
    };
  }

  /**
   * Increment tickets sold for a schedule (used during ticket purchase)
   * @param {string} scheduleId - Schedule ID
   * @param {number} quantity - Number of tickets to increment
   * @returns {Promise<Object>} - Updated schedule
   */
  static async incrementTicketsSold(scheduleId, quantity) {
    const [updated] = await db
      .update(eventSchedules)
      .set({
        ticketsSold: sql`${eventSchedules.ticketsSold} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(eventSchedules.id, scheduleId))
      .returning();

    return updated;
  }

  /**
   * Decrement tickets sold for a schedule (used during refund)
   * @param {string} scheduleId - Schedule ID
   * @param {number} quantity - Number of tickets to decrement
   * @returns {Promise<Object>} - Updated schedule
   */
  static async decrementTicketsSold(scheduleId, quantity) {
    const [updated] = await db
      .update(eventSchedules)
      .set({
        ticketsSold: sql`GREATEST(0, ${eventSchedules.ticketsSold} - ${quantity})`,
        updatedAt: new Date(),
      })
      .where(eq(eventSchedules.id, scheduleId))
      .returning();

    return updated;
  }
  /**
   * Create multiple event sessions/schedules for an event
   * @param {string} eventId - Event ID
   * @param {string} eventTitle - Event title
   * @param {string} eventDescription - Event description
   * @param {Array} sessions - Array of session objects
   * @returns {Promise<Array>} - Created sessions
   */
  static async createEventSessions(eventId, eventTitle, eventDescription, sessions) {
    if (!sessions || sessions.length === 0) {
      return [];
    }

    // Validate all sessions first
    const sessionData = sessions.map(session => {
      const start = new Date(session.startTime);
      const end = new Date(session.endTime);

      if (end <= start) {
        throw new ApiError(400, 'End time must be after start time for all sessions');
      }

      const duration = Math.floor((end - start) / (1000 * 60)); // Duration in minutes

      return {
        eventId,
        title: session.title || eventTitle,
        description: session.description || eventDescription,
        date: new Date(session.date),
        startTime: start,
        endTime: end,
        duration,
        ticketsSold: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    // Check for overlaps between new sessions
    for (let i = 0; i < sessionData.length; i++) {
      for (let j = i + 1; j < sessionData.length; j++) {
        const session1 = sessionData[i];
        const session2 = sessionData[j];

        // Check if sessions overlap
        if (session1.startTime < session2.endTime && session1.endTime > session2.startTime) {
          throw new ApiError(
            400,
            `Sessions overlap: Two event sessions overlap with each other. Please choose different times.`
          );
        }
      }
    }

    // Check for overlaps with existing schedules
    const existingSchedules = await db.query.eventSchedules.findMany({
      where: and(eq(eventSchedules.eventId, eventId), isNull(eventSchedules.deletedAt)),
    });

    for (const newSession of sessionData) {
      for (const existing of existingSchedules) {
        if (
          newSession.startTime < new Date(existing.endTime) &&
          newSession.endTime > new Date(existing.startTime)
        ) {
          throw new ApiError(
            400,
            `New session "${newSession.title}" overlaps with existing session "${existing.title}". Please choose different times.`
          );
        }
      }
    }

    // Create all sessions
    const createdSessions = await db.insert(eventSchedules).values(sessionData).returning();

    // Calculate event date range and update parent event
    const allSchedules = await db.query.eventSchedules.findMany({
      where: and(eq(eventSchedules.eventId, eventId), isNull(eventSchedules.deletedAt)),
      orderBy: [eventSchedules.date, eventSchedules.startTime],
    });

    const { startDate, endDate } = calculateEventDateRange(allSchedules);

    await db
      .update(events)
      .set({
        startDate,
        endDate,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId));

    return createdSessions;
  }
  /**
   * Validate schedule capacity before ticket purchase
   * @param {string} scheduleId - Schedule ID
   * @param {number} requestedQuantity - Number of tickets requested
   * @returns {Promise<Object>} - Schedule and event info
   */
  static async validateScheduleCapacity(scheduleId, requestedQuantity) {
    const schedule = await db.query.eventSchedules.findFirst({
      where: and(eq(eventSchedules.id, scheduleId), isNull(eventSchedules.deletedAt)),
      with: {
        event: {
          columns: {
            id: true,
            title: true,
            capacity: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new ApiError(404, 'Event schedule not found');
    }

    // Check if event has capacity limit
    if (schedule.event.capacity) {
      const availableTickets = schedule.event.capacity - schedule.ticketsSold;

      if (requestedQuantity > availableTickets) {
        throw new ApiError(
          400,
          `Only ${availableTickets} tickets available for this session. You requested ${requestedQuantity}.`
        );
      }
    }

    return schedule;
  }
}
