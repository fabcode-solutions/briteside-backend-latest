import { db } from '../db/index.js';
import { eventVirtualDetails, purchasedTickets, events, organizers } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { StreamCallService } from './stream.service.js';

export class VirtualDetailsService {
  /**
   * Create a Stream (getstream.io) call for a briteside event and return its link.
   * Call id is deterministic per event so re-generation is idempotent.
   */
  static async generateBritesideCall(eventId) {
    const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!event) throw new ApiError(404, 'Event not found');

    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.id, event.organizerId),
    });
    if (!organizer) throw new ApiError(404, 'Organizer not found for event');

    const callId = `event-${eventId}`;

    try {
      await StreamCallService.registerOnStream({
        callId,
        type: 'livestream',
        created_by_user_id: organizer.userId,
        members: [{ user_id: organizer.userId, role: 'host' }],
        custom: { eventId, eventTitle: event.title },
      });
    } catch (err) {
      console.error('Failed to create Stream call for briteside event:', err);
      throw new ApiError(500, 'Failed to create virtual meeting link');
    }

    const meetingLink = `${process.env.CLIENT_URL || 'https://www.briteside.app/'}/virtual-event/${eventId}`;

    return { callId, meetingLink };
  }

  static async createVirtualDetails(eventId, virtualData) {
    if (!eventId || !virtualData) {
      throw new ApiError(400, 'Event ID and virtual data are required');
    }

    const existing = await db.query.eventVirtualDetails.findFirst({
      where: eq(eventVirtualDetails.eventId, eventId),
    });

    if (existing) {
      throw new ApiError(400, 'Virtual details already exist for this event');
    }

    let briteVideoLink = virtualData.briteVideoLink || null;
    let streamCallId = null;

    if (virtualData.virtualPlatform === 'briteside' && !briteVideoLink) {
      const { callId, meetingLink } = await this.generateBritesideCall(eventId);
      briteVideoLink = meetingLink;
      streamCallId = callId;
    }

    const [created] = await db
      .insert(eventVirtualDetails)
      .values({
        eventId,
        virtualPlatform: virtualData.virtualPlatform,
        meetingLink: virtualData.meetingLink || null,
        duration: virtualData.duration || null,
        maxAttendees: virtualData.maxAttendees || null,
        briteVideoLink,
        streamCallId,
        platformName: virtualData.platformName || null,
        accessInstructions: virtualData.accessInstructions || null,
        password: virtualData.password || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created;
  }
   /**
   * Update virtual details for an event and sync with existing tickets
   * @param {string} eventId - The event ID
   * @param {Object} virtualData - Virtual details data to update
   * @returns {Promise<Object>} Updated virtual details
   */  
  static async updateVirtualDetails(eventId, virtualData) {
    if (!eventId || !virtualData) {
      throw new ApiError(400, 'Event ID and virtual data are required');
    }

    // Check if virtual details exist
    const existing = await db.query.eventVirtualDetails.findFirst({
      where: eq(eventVirtualDetails.eventId, eventId),
    });

    if (!existing) {
   // If no existing details, create new ones
      return this.createVirtualDetails(eventId, virtualData);
    }

    // Build update data - only include fields that are provided
    const updateData = {
      updatedAt: new Date(),
    };

    if (virtualData.virtualPlatform !== undefined) {
      updateData.virtualPlatform = virtualData.virtualPlatform;
    }
    if (virtualData.meetingLink !== undefined) {
      updateData.meetingLink = virtualData.meetingLink;
    }
    if (virtualData.duration !== undefined) {
      updateData.duration = virtualData.duration;
    }
    if (virtualData.maxAttendees !== undefined) {
      updateData.maxAttendees = virtualData.maxAttendees;
    }
    if (virtualData.briteVideoLink !== undefined) {
      updateData.briteVideoLink = virtualData.briteVideoLink;
    }
    if (virtualData.platformName !== undefined) {
      updateData.platformName = virtualData.platformName;
    }
    if (virtualData.accessInstructions !== undefined) {
      updateData.accessInstructions = virtualData.accessInstructions;
    }
    if (virtualData.password !== undefined) {
      updateData.password = virtualData.password;
    }

    // Switching to briteside (or clearing the link) without a manual link → auto-generate
    const switchingToBriteside =
      (virtualData.virtualPlatform === 'briteside' ||
        (virtualData.virtualPlatform === undefined && existing.virtualPlatform === 'briteside')) &&
      updateData.briteVideoLink === undefined &&
      !existing.briteVideoLink;

    if (switchingToBriteside) {
      const { callId, meetingLink } = await this.generateBritesideCall(eventId);
      updateData.briteVideoLink = meetingLink;
      updateData.streamCallId = callId;
    }

    const [updated] = await db
      .update(eventVirtualDetails)
      .set(updateData)
      .where(eq(eventVirtualDetails.eventId, eventId))
      .returning();

    // Update QR codes for all existing tickets of this event
    await this.syncTicketVirtualDetails(eventId, updated);

    return updated;
  }
   /**
   * Get virtual details for an event
   * @param {string} eventId - The event ID
   * @returns {Promise<Object|null>} Virtual details or null
   */
  static async getVirtualDetails(eventId) {
    return db.query.eventVirtualDetails.findFirst({
      where: eq(eventVirtualDetails.eventId, eventId),
    });
  }
  /**
   * Delete virtual details for an event
   * @param {string} eventId - The event ID
   * @returns {Promise<void>}
   */
  static async deleteVirtualDetails(eventId) {
    await db.delete(eventVirtualDetails).where(eq(eventVirtualDetails.eventId, eventId));
  }
 /**
   * Sync virtual details in all existing ticket QR codes for an event
   * @param {string} eventId - The event ID
   * @param {Object} virtualDetails - The updated virtual details
   * @returns {Promise<number>} Number of tickets updated
   */
  static async syncTicketVirtualDetails(eventId, virtualDetails) {
  // Fetch all purchased tickets for this event
    const tickets = await db.query.purchasedTickets.findMany({
      where: eq(purchasedTickets.eventId, eventId),
    });

    if (!tickets || tickets.length === 0) {
      return 0;
    }

    const virtualDetailsForQR = virtualDetails
      ? {
          virtualPlatform: virtualDetails.virtualPlatform,
          platformName: virtualDetails.platformName,
          meetingLink: virtualDetails.meetingLink,
          briteVideoLink: virtualDetails.briteVideoLink,
          password: virtualDetails.password,
          accessInstructions: virtualDetails.accessInstructions,
        }
      : null;

    let updatedCount = 0;

    for (const ticket of tickets) {
      try {
        // Parse existing QR code data
        let qrCodeData;
        try {
          qrCodeData =
            typeof ticket.qrCode === 'string' ? JSON.parse(ticket.qrCode) : ticket.qrCode;
        } catch {
        // If QR code is not valid JSON, skip this ticket
          console.warn(`Skipping ticket ${ticket.id} - invalid QR code format`);
          continue;
        }

        // Update virtual details in QR code
        qrCodeData.virtualDetails = virtualDetailsForQR;

        // Save updated QR code
        await db
          .update(purchasedTickets)
          .set({
            qrCode: JSON.stringify(qrCodeData),
            updatedAt: new Date(),
          })
          .where(eq(purchasedTickets.id, ticket.id));

        updatedCount++;
      } catch (err) {
        console.error(`Failed to update QR code for ticket ${ticket.id}:`, err);
      }
    }

    console.log(
      `Updated virtual details in ${updatedCount}/${tickets.length} tickets for event ${eventId}`
    );
    return updatedCount;
  }

   /**
   * Get basic virtual details info (no sensitive data like links/passwords)
   * @param {string} eventId - The event ID
   * @returns {Promise<Object|null>} Basic virtual details or null
   */
  static async getBasicVirtualDetails(eventId) {
    const details = await this.getVirtualDetails(eventId);
    if (!details) return null;

    return {
      virtualPlatform: details.virtualPlatform,
      platformName: details.platformName,
      duration: details.duration,
      maxAttendees: details.maxAttendees,
    };
  }
}