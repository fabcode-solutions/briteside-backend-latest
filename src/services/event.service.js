import { db } from '../db/index.js';
import {
  events,
  eventSchedules,
  eventTickets,
  eventMerchandise,
  eventMedia,
  eventLikes,
  eventVenueProfiles,
  purchasedTickets,
  purchasedMerchandise,
  organizers,
  venues,
  categories,
  users,
  groups,
  eventTeams,
  eventTeamMembers,
  orders,
  organizerPayouts,
  eventReviews,
} from '../db/schema/index.js';
import { createNotification } from './notification.service.js';
import {
  eq,
  and,
  desc,
  asc,
  like,
  gte,
  lte,
  count,
  sql,
  or,
  exists,
  lt,
  ilike,
  inArray,
  isNull,
  ne,
  avg,
} from 'drizzle-orm';
import { generateEventCode, generateTicketCode } from '../utils/code-generator.js';
import QRCode from 'qrcode';
import slugify from 'slugify';
import { UploadService } from './upload.service.js';
import { SocialService } from './social.service.js';
import FileManagementService from './fileManagement.service.js';
import ApiError from '../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';
import { MediaModerationService, MEDIA_ENTITY } from './moderation/mediaModeration.service.js';
import { eventTicketScheduleInventory } from '../db/schema/index.js';
import {
  getUserInformation,
  getUserTicketCountForTier,
  getUserTicketCountsForTiers,
} from '../utils/helper.js';
import {
  sendEventPublishedEmail,
  sendTicketPurchaseEmail,
  sendEventCancellationEmail,
  sendEventRescheduledEmail,
  sendEventVenueChangedEmail,
  sendEventDateAndVenueChangedEmail,
} from './eventMail.helper.js';
import { RefundService } from './refund.service.js';
import dayjs from 'dayjs';
import { OrganizerService } from './organizer.service.js';
import { createEventTopic, deleteEventTopic } from '../utils/aws.util.js';
import { OrganizerPresetService } from './organizerPreset.service.js';
import {
  parseDistanceToKm,
  calculateDistance,
  buildDistanceCondition,
  buildDateConditions,
  buildPriceConditions,
  applyLocationFilter,
  getLowestTicketPrice,
  formatDistance,
  buildPaginationResponse,
  enhanceEventData,
  enhanceEventsData,
  filterEventsByLocation,
  calculateEventDateRange,
  generateUniqueSlug,
} from '../utils/event-helpers.js';
import { generateOccurrences } from '../utils/recurrence.js';
import { getEventSchedules } from '../controllers/eventSchedule.controller.js';
import { EventScheduleService } from './eventSchedule.service.js';
import { VirtualDetailsService } from './virtualDetails.service.js';
import { ReviewService } from './review.service.js';
import { EventChatService } from './eventChat.service.js';
import TrackingLinkService from './trackingLink.service.js';

async function createAndStoreTopic(eventId, title) {
  const topicArn = await createEventTopic(eventId, title);
  await db.update(events).set({ snsTopicArn: topicArn }).where(eq(events.id, eventId));
  return topicArn;
}

export class EventService {
  /**
   * Fetch categories by their IDs and return as a Map for easy lookup
   * @param {Set|Array} categoryIds - Set or array of category IDs
   * @returns {Promise<Map>} - Map of categoryId -> category object
   */
  static async getCategoriesByIds(categoryIds) {
    const idsArray = Array.isArray(categoryIds) ? categoryIds : Array.from(categoryIds);

    if (idsArray.length === 0) return new Map();

    const categoryRecords = await db.query.categories.findMany({
      where: inArray(categories.id, idsArray),
    });

    const categoryMap = new Map();
    categoryRecords.forEach(cat => categoryMap.set(cat.id, cat));
    return categoryMap;
  }

  /**
   * Enrich events with their categories - modifies events in place
   * @param {Array} events - Array of event objects
   * @returns {Promise<void>}
   */
  static async enrichEventsWithCategories(events) {
    if (!events || events.length === 0) return;

    // Collect all unique category IDs
    const categoryIdsSet = new Set();
    events.forEach(event => {
      if (event.categoryIds && Array.isArray(event.categoryIds)) {
        event.categoryIds.forEach(id => categoryIdsSet.add(id));
      }
    });

    // Fetch all categories
    const categoryMap = await this.getCategoriesByIds(categoryIdsSet);

    // Map categories to each event
    events.forEach(event => {
      event.categories =
        event.categoryIds && Array.isArray(event.categoryIds)
          ? event.categoryIds.map(id => categoryMap.get(id)).filter(Boolean)
          : [];
    });
  }

  /**
   * Gallery (eventMedia) has no per-item moderation row, so a file rejected/
   * flagged BEFORE its eventMedia row existed never notified the owner
   * (propagateMediaVerdict found no gallery hit at webhook time). Re-run the
   * cascade for these URLs now that the rows exist — DRY: reuses the
   * gallery-notify branch in propagateMediaVerdict.
   */
  static async notifyGalleryMediaVerdicts(urls) {
    for (const url of (urls || []).filter(Boolean)) {
      const rows = await MediaModerationService.mediaRowsForUrls([url]);
      const status = MediaModerationService.aggregateStatus(rows);
      if (status === 'rejected' || status === 'flagged') {
        await MediaModerationService.propagateMediaVerdict(url, status);
      }
    }
  }

  static async createEvent(organizerId, eventData) {
    let createdTopicArn = null;
    try {
      const eventCode = generateEventCode();
      const baseSlug = slugify(eventData.title, { lower: true, strict: true });
      const slug = await generateUniqueSlug(baseSlug);
      // Verify organizer exists
      const organizer = await db.query.organizers.findFirst({
        where: eq(organizers.id, organizerId),
      });

      if (!organizer) {
        throw new ApiError(404, 'Organizer not found');
      }

      // Extract sessions and other non-event fields
      const {
        invitations,
        tickets,
        merchandise,
        media,
        additionalDetails,
        sessions,
        virtualDetails,
        recurrenceRule,
        presetId,
        venueProfile,
        ...rest
      } = eventData;

      if (presetId) {
        await OrganizerPresetService.validatePresetOwnership(organizerId, presetId);
      }

      // Resolve sessions — either expand the recurring rule or use the direct array
      let resolvedSessions = sessions;
      if (recurrenceRule) {
        resolvedSessions = generateOccurrences(recurrenceRule);
      }

      // Validate sessions are provided
      if (!resolvedSessions || resolvedSessions.length === 0) {
        throw new ApiError(400, 'At least one session is required for the event');
      }

      // Calculate event date range from sessions before creating the event
      const { startDate, endDate } = calculateEventDateRange(resolvedSessions);

      if (!startDate || !endDate) {
        throw new ApiError(400, 'Invalid session dates provided');
      }

      // "Platform & Service Fee" only ever applies if the organizer explicitly
      // set one during setup — no fallback to an admin-wide default. An
      // organizer who never touches this field gets 0, not a silently
      // applied platform-wide rate.
      let platformFeePercentage = 0;
      const organizerFee = parseFloat(rest.platformFeePercentage);
      if (!isNaN(organizerFee) && organizerFee >= 0 && organizerFee <= 100) {
        platformFeePercentage = organizerFee;
      }

      // Only include valid event table columns
      const processedEventData = {
        title: rest.title,
        description: rest.description,
        categoryIds: rest.categoryIds || [],
        venueId: rest.venueId,
        eventType: rest.eventType,
        eventStatus: rest.eventStatus,
        eventMode: rest.eventMode,
        isFree: rest.isFree,
        capacity: rest.capacity,
        coverImages: rest.coverImages || [],
        attendReason: rest.attendReason,
        eventHighlights: rest.eventHighlights || [],
        showAttendeeCount: rest.showAttendeeCount !== undefined ? rest.showAttendeeCount : true,
        isChatEnabled: rest.isChatEnabled !== undefined ? rest.isChatEnabled : true,
        platformFeePercentage,
        isRefundable: rest.isRefundable !== undefined ? rest.isRefundable : true,
        refundCutoffDays: rest.refundCutoffDays || 3,
        hostedBy: rest.hostedBy,
        groupId: rest.groupId || null,
        refundPolicy: rest.refundPolicy,
        termsConditions: rest.termsConditions,
        recurrenceRule: recurrenceRule || null,
        startDate, // Calculated from sessions
        endDate, // Calculated from sessions
        youtubeVideoUrl: rest.youtubeVideoUrl || null,
        presetId: presetId || null,
        showLikeCount: rest.showLikeCount !== undefined ? rest.showLikeCount : true,
        showTicketsRemaining:
          rest.showTicketsRemaining !== undefined ? rest.showTicketsRemaining : true,
      };

      const eventModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.EVENT,
        entityCreatorId: organizerId,
        texts: [processedEventData.title, processedEventData.description],
      });

      const [event] = await db
        .insert(events)
        .values({
          ...processedEventData,
          eventCode,
          slug,
          organizerId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Cover images gate sales/publish — inherit their files' verdicts
      await MediaModerationService.adoptMediaVerdicts({
        entityType: MEDIA_ENTITY.EVENT,
        entityId: event.id,
        userId: null,
        ...MediaModerationService.splitUrls(event.coverImages),
      });

      await TextModerationService.recordIfFlagged(eventModeration, {
        entityType: TEXT_ENTITY.EVENT,
        entityId: event.id,
        userId: null,
        fieldNames: ['title', 'description'],
        texts: [processedEventData.title, processedEventData.description],
      });

      if (rest.venueId) {
        await db.insert(eventVenueProfiles).values({
          eventId: event.id,
          venueId: rest.venueId,
          description: venueProfile?.description ?? null,
          capacity: venueProfile?.capacity ?? null,
          amenities: venueProfile?.amenities ?? [],
          additionalInformation: venueProfile?.additionalInformation ?? {},
          cancellationPolicy: venueProfile?.cancellationPolicy ?? null,
          accessibility: venueProfile?.accessibility ?? [],
          contactEmail: venueProfile?.contactEmail ?? null,
          contactPhone: venueProfile?.contactPhone ?? null,
          parkingInfo: venueProfile?.parkingInfo ?? null,
          publicTransportInfo: venueProfile?.publicTransportInfo ?? null,
          emoji: venueProfile?.emoji ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Create sessions - will handle date validation, overlap checks, and update event dates
      await EventScheduleService.createEventSessions(
        event.id,
        rest.title,
        rest.description,
        resolvedSessions
      );

      // Create virtual details if event is virtual and details are provided
      if (rest.eventMode === 'virtual' && virtualDetails) {
        await VirtualDetailsService.createVirtualDetails(event.id, virtualDetails);
      }

      if (tickets && tickets.length > 0) {
        const ticketData = tickets.map(ticket => {
          const { id, ...ticketWithoutId } = ticket;
          return {
            ...ticketWithoutId,
            ticketCode: generateTicketCode(),
            salesStart: new Date(ticket.salesStart),
            salesEnd: new Date(ticket.salesEnd),
            eventId: event.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        });
        await db.insert(eventTickets).values(ticketData);

        // Create per-session inventory rows
        if (resolvedSessions.length > 0) {
          const createdTickets = await db.query.eventTickets.findMany({
            where: eq(eventTickets.eventId, event.id),
          });
          const createdSchedules = await db.query.eventSchedules.findMany({
            where: and(eq(eventSchedules.eventId, event.id), isNull(eventSchedules.deletedAt)),
          });

          if (createdTickets.length > 0 && createdSchedules.length > 0) {
            const inventoryRows = [];
            for (const ticket of createdTickets) {
              const qtyPerSession = ticket.quantityAvailable;
              for (const schedule of createdSchedules) {
                inventoryRows.push({
                  eventId: event.id,
                  ticketTierId: ticket.id,
                  scheduleId: schedule.id,
                  quantityAvailable: qtyPerSession,
                  quantitySold: 0,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
              }
            }
            await db.insert(eventTicketScheduleInventory).values(inventoryRows);
          }
        }
      }

      // Create merchandise if provided
      if (merchandise && merchandise.length > 0) {
        const merchandiseData = merchandise.map(item => {
          const { id, ...itemWithoutId } = item; // Remove frontend-generated id
          return {
            ...itemWithoutId,
            eventId: event.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        });
        await db.insert(eventMerchandise).values(merchandiseData);
      }

      // Create media if provided
      if (media && media.length > 0) {
        const mediaData = media.map(item => ({
          eventId: event.id,
          uploaderId: organizer.userId,
          mediaUrl: item.url,
          mediaType: item.type,
          caption: item.caption || null,
          createdAt: new Date(),
        }));
        await db.insert(eventMedia).values(mediaData);
        await this.notifyGalleryMediaVerdicts(media.map(item => item.url));
      }

      // Send invitations if provided
      if (invitations && invitations.length > 0) {
        // Import social service to send invitations
        const invitationResult = await SocialService.inviteToEvent(
          event.id,
          organizer.userId,
          invitations
        );

        // Send notifications to all invited users
        if (invitationResult.invitations && invitationResult.invitations.length > 0) {
          const notificationPromises = invitationResult.invitations.map(invitation =>
            createNotification({
              userId: invitation.inviteeId,
              title: 'Event Invitation',
              message: `${invitationResult.inviter.username} invited you to ${invitationResult.event.title}`,
              type: 'event_update',
              relatedId: event.id,
              redirectTo: `/events/${event.slug}`,
              metadata: {
                eventId: event.id,
                eventTitle: invitationResult.event.title,
                eventCode: invitationResult.event.eventCode,
                inviterId: invitationResult.inviter.id,
                inviterUsername: invitationResult.inviter.username,
                invitationId: invitation.id,
                organizerLogoUrl: organizer.logoUrl ?? null,
              },
            }).catch(err => {
              console.warn(
                `Failed to create invitation notification for user ${invitation.inviteeId}:`,
                err
              );
              return null;
            })
          );

          // Wait for all notifications to be sent (non-blocking for failures)
          await Promise.allSettled(notificationPromises);
        }
      }

      if (event.eventStatus === 'published') {
        try {
          createdTopicArn = await createAndStoreTopic(event.id, event.title);
        } catch (snsError) {
          console.error('Failed to create SNS topic on event create:', snsError);
        }
      }

      return this.getEventById(event.id);
    } catch (error) {
      if (createdTopicArn) {
        deleteEventTopic(createdTopicArn).catch(e =>
          console.error('Failed to clean up SNS topic after event creation failure:', e)
        );
      }
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Event creation error:', {
        message: error.message,
        code: error.code,
        constraint: error.constraint,
        detail: error.detail,
      });

      // Handle specific database constraint errors
      if (error.constraint === 'end_date_check') {
        throw new ApiError(400, 'End date must be after start date');
      }

      throw new ApiError(500, `Failed to create event: ${error.message}`);
    }
  }

  /**
   * Refund purchased merchandise items and restore event merchandise stock.
   * merchRefunds: [{ id: <purchasedMerchId>, amount?: <number|string> }, ...]
   */
  static async refundPurchasedMerchandise(merchRefunds = []) {
    if (!merchRefunds || merchRefunds.length === 0) return [];

    const ids = merchRefunds.map(m => m.id).filter(Boolean);
    if (ids.length === 0) return [];

    const purchased = await db.query.purchasedMerchandise.findMany({
      where: inArray(purchasedMerchandise.id, ids),
    });

    const updated = [];
    for (const pm of purchased) {
      const entry = merchRefunds.find(r => r.id === pm.id) || {};
      const amount = entry.amount || pm.totalPrice || 0;

      await db
        .update(purchasedMerchandise)
        .set({
          refundedAt: new Date(),
          refundAmount: amount,
          status: 'refunded',
        })
        .where(eq(purchasedMerchandise.id, pm.id));

      // restore inventory for the event merchandise
      const merch = await db.query.eventMerchandise.findFirst({
        where: eq(eventMerchandise.id, pm.merchandiseId),
      });
      if (merch) {
        await db
          .update(eventMerchandise)
          .set({
            quantityAvailable: (merch.quantityAvailable || 0) + (pm.quantity || 0),
            updatedAt: new Date(),
          })
          .where(eq(eventMerchandise.id, merch.id));
      }

      const refreshed = await db.query.purchasedMerchandise.findFirst({
        where: eq(purchasedMerchandise.id, pm.id),
      });
      if (refreshed) updated.push(refreshed);
    }

    return updated;
  }

  //   static async getDiscoverEvents(filters, userId = null) {
  //     try {
  //       const {
  //         page = 1,
  //         limit = 12,
  //         categoryId,
  //         search,
  //         timeFilter,
  //         location,
  //         dateRange,
  //         priceFilter,
  //         city,
  //         state,
  //         country,
  //         eventMode,
  //         lat,
  //         lng,
  //         distance,
  //       } = filters;
  //       const offset = (page - 1) * limit;
  //       const now = new Date();
  //       let venuesConditions = [];
  //       let conditions = [
  //         eq(events.eventStatus, 'published'),
  //         // eq(events.eventType, 'public'),
  //         gte(events.startDate, now), // Only show future events
  //       ];

  //       // Existing filters
  //       if (categoryId) {
  //         conditions.push(eq(events.categoryId, categoryId));
  //       }

  //       if (search) {
  //         conditions.push(ilike(events.title, `%${search}%`));
  //       }

  //       // Enhanced date filtering (reusing existing patterns)
  //       const dateConditions = buildDateConditions(timeFilter, dateRange);
  //       conditions.push(...dateConditions);

  //       // New event mode filter
  //       if (eventMode) {
  //         conditions.push(eq(events.eventMode, eventMode));
  //       }
  //       if (country) {
  //         venuesConditions.push(eq(venues.country, country));
  //       }
  //       if (state) {
  //         venuesConditions.push(eq(venues.state, state));
  //       }
  //       // Price filter
  //       const priceCondition = buildPriceConditions(priceFilter);
  //       if (priceCondition) {
  //         conditions.push(priceCondition);
  //       }

  //       // Distance-based location filtering (Haversine)
  //       let useDistanceFilter = false;
  //       if (lat && lng && distance) {
  //         const distanceKm = parseDistanceToKm(distance);
  //         if (distanceKm && distanceKm <= 200) {
  //           // Max 200km radius
  //           const distanceCondition = buildDistanceCondition(lat, lng, distanceKm);
  //           if (distanceCondition) {
  //             useDistanceFilter = true;

  //             // Use SQL join approach for distance filtering
  //             const eventsWithDistance = await db
  //               .select({
  //                 eventId: events.id,
  //               })
  //               .from(events)
  //               .innerJoin(venues, eq(events.venueId, venues.id))
  //               .where(
  //                 and(
  //                   ...conditions,
  //                   distanceCondition,
  //                   ...venuesConditions,
  //                   sql`${venues.latitude} IS NOT NULL`,
  //                   sql`${venues.longitude} IS NOT NULL`
  //                 )
  //               );

  //             const eventIds = eventsWithDistance.map(e => e.eventId);

  //             if (eventIds.length === 0) {
  //               return {
  //                 events: [],
  //                 pagination: {
  //                   page,
  //                   limit,
  //                   total: 0,
  //                   hasNext: false,
  //                   hasPrev: page > 1,
  //                 },
  //               };
  //             }

  //             conditions.push(sql`${events.id} = ANY(${eventIds})`);
  //           }
  //         }
  //       } else if (location && typeof location === 'string' && location.trim()) {
  //         // Text-based location filtering (existing logic)
  //         const locationFilteredEvents = await db.query.events.findMany({
  //           where: and(...conditions, ...venuesConditions),
  //           with: {
  //             venue: true,
  //           },
  //         });

  //         const filteredEvents = filterEventsByLocation(locationFilteredEvents, location);
  //         const filteredEventIds = filteredEvents.map(event => event.id);

  //         if (filteredEventIds.length === 0) {
  //           return {
  //             events: [],
  //             pagination: buildPaginationResponse(page, limit, 0),
  //           };
  //         }

  //         // Add location filter to conditions
  //         conditions.push(sql`${events.id} = ANY(${filteredEventIds})`);
  //       }
  // console.log('Discover event conditions:', conditions,venuesConditions);
  //       const [eventsResult, totalCount] = await Promise.all([
  //         db.query.events.findMany({
  //           where: and(...conditions),
  //           with: {
  //             category: true,
  //             venue: true,
  //             organizer: true,
  //           },
  //           orderBy: desc(events.createdAt),
  //           limit,
  //           offset,
  //         }),
  //         db
  //           .select({ count: count() })
  //           .from(events)
  //           .innerJoin(venues, eq(events.venueId, venues.id))
  //           .where(and(...conditions, ...venuesConditions)),
  //       ]);

  //       // Add lowest ticket price and distance for each event
  //       const eventsWithPrices = await enhanceEventsData(eventsResult, lat, lng, distance);

  //       return {
  //         events: eventsWithPrices,
  //         pagination: buildPaginationResponse(page, limit, totalCount[0].count),
  //       };
  //     } catch (error) {
  //       console.error('Get discover events error:', error);
  //       throw new ApiError(500, 'Failed to get discover events');
  //     }
  //   }

  // static async getDiscoverEvents(filters, userId = null) {
  //   try {
  //     const {
  //       page = 1,
  //       limit = 12,
  //       categoryId,
  //       search,
  //       timeFilter,
  //       location,
  //       dateRange,
  //       priceFilter,
  //       country,
  //       state,
  //       eventMode,
  //       lat,
  //       lng,
  //       distance,
  //     } = filters;

  //     const offset = (page - 1) * limit;
  //     const now = new Date();

  //     // 1. Build Base Conditions
  //     let venuesConditions = [];
  //     let conditions = [eq(events.eventStatus, 'published'), gte(events.startDate, now)];

  //     if (categoryId) conditions.push(eq(events.categoryId, categoryId));
  //     if (search) conditions.push(ilike(events.title, `%${search}%`));
  //     if (eventMode) conditions.push(eq(events.eventMode, eventMode));

  //     const dateConditions = buildDateConditions(timeFilter, dateRange);
  //     conditions.push(...dateConditions);

  //     const priceCondition = buildPriceConditions(priceFilter);
  //     if (priceCondition) conditions.push(priceCondition);
  //     let userLocation = null;
  //     // 2. Build Venue-Specific Conditions
  //     if (country) venuesConditions.push(eq(venues.country, country));
  //     if (state) venuesConditions.push(eq(venues.state, state));
  //     if (userId) {
  //        userLocation = getUserInformation(userId);
  //        console.log('User location for discover events:', userLocation);
  //     }
  //     // 3. Handle Advanced Filtering (Distance/Location)
  //     // This part remains logic-heavy to ensure previous code doesn't break
  //     if (lat && lng && distance) {
  //       const distanceKm = parseDistanceToKm(distance);
  //       if (distanceKm && distanceKm <= 200) {
  //         const distanceCondition = buildDistanceCondition(lat, lng, distanceKm);
  //         if (distanceCondition) {
  //           // Pre-filter IDs using a join to handle the spatial math
  //           const eventsWithDistance = await db
  //             .select({ id: events.id })
  //             .from(events)
  //             .innerJoin(venues, eq(events.venueId, venues.id))
  //             .where(and(...conditions, ...venuesConditions, distanceCondition));

  //           const eventIds = eventsWithDistance.map(e => e.id);
  //           if (eventIds.length === 0) return this.emptyPaginationResponse(page, limit);
  //           conditions.push(inArray(events.id, eventIds));
  //         }
  //       }
  //     } else if (location?.trim()) {
  //       // Keep your existing text-based location filtering logic
  //       const locationFilteredEvents = await db.query.events.findMany({
  //         where: and(...conditions), // db.query only takes event conditions
  //         with: { venue: true },
  //       });

  //       const filteredEvents = filterEventsByLocation(locationFilteredEvents, location);
  //       const filteredIds = filteredEvents.map(e => e.id);

  //       if (filteredIds.length === 0) return this.emptyPaginationResponse(page, limit);
  //       conditions.push(inArray(events.id, filteredIds));
  //     }

  //     // 4. MAIN QUERY: Refactored to use db.select for Join-filtering support
  //     const [eventsResult, totalCount] = await Promise.all([
  //       db
  //         .select({
  //           // This allows us to maintain the structure expected by enhanceEventsData
  //           event: events,
  //           category: categories,
  //           venue: venues,
  //           organizer: users,
  //         })
  //         .from(events)
  //         .leftJoin(venues, eq(events.venueId, venues.id))
  //         .leftJoin(categories, eq(events.categoryId, categories.id))
  //         .leftJoin(users, eq(events.organizerId, users.id))
  //         .where(and(...conditions, ...venuesConditions))
  //         .orderBy(desc(events.createdAt))
  //         .limit(limit)
  //         .offset(offset),

  //       db
  //         .select({ count: count() })
  //         .from(events)
  //         .innerJoin(venues, eq(events.venueId, venues.id))
  //         .where(and(...conditions, ...venuesConditions)),
  //     ]);

  //     // 5. Format results to match the previous "Relational API" shape
  //     // db.select returns { event: {}, venue: {} }. We flatten it slightly
  //     // so enhanceEventsData doesn't break.
  //     const formattedEvents = eventsResult.map(row => ({
  //       ...row.event,
  //       category: row.category,
  //       venue: row.venue,
  //       organizer: row.organizer,
  //     }));

  //     const eventsWithPrices = await enhanceEventsData(formattedEvents, lat, lng, distance);

  //     return {
  //       events: eventsWithPrices,
  //       pagination: buildPaginationResponse(page, limit, totalCount[0].count),
  //     };
  //   } catch (error) {
  //     console.error('Get discover events error:', error);
  //     throw new ApiError(500, 'Failed to get discover events');
  //   }
  // }
  static async getDiscoverEvents(filters, userId = null) {
    try {
      const {
        page = 1,
        limit = 12,
        categoryId,
        search,
        timeFilter,
        location,
        dateRange,
        eventType,
        priceFilter,
        country,
        state,
        eventMode,
        distance,
      } = filters;

      // Local variables to hold coordinates for distance logic
      let { lat, lng } = filters;

      const offset = (page - 1) * limit;
      const now = new Date();

      // 1. Build Base Conditions
      let venuesConditions = [];
      let conditions = [eq(events.eventStatus, 'published')];
      // Keep default behavior of showing upcoming events, but allow 'all' to include past events
      if (timeFilter !== 'all') {
        conditions.push(gte(events.startDate, now));
      }

      // Handle categoryId filtering - supports single UUID or array of UUIDs for JSONB array containment
      if (categoryId) {
        if (Array.isArray(categoryId)) {
          // If categoryId is an array, check if any of the IDs are in the event's categoryIds array
          const categoryConditions = categoryId.map(
            id => sql`${events.categoryIds}::jsonb @> ${JSON.stringify([id])}::jsonb`
          );
          conditions.push(or(...categoryConditions));
        } else {
          // Single category ID - check if it exists in the categoryIds array
          conditions.push(
            sql`${events.categoryIds}::jsonb @> ${JSON.stringify([categoryId])}::jsonb`
          );
        }
      }
      if (search) conditions.push(ilike(events.title, `%${search}%`));
      if (eventMode) conditions.push(eq(events.eventMode, eventMode));

      const dateConditions = buildDateConditions(timeFilter, dateRange);
      conditions.push(...dateConditions);

      const priceCondition = buildPriceConditions(priceFilter);
      if (priceCondition) conditions.push(priceCondition);
      if (eventType) conditions.push(eq(events.eventType, eventType));
      // NEW: Handle User Location for distance calculation
      if (userId) {
        const { userInformation: userLocation } = await getUserInformation(userId);
        console.log('User location for discover events:', userLocation);

        // If the user has coordinates and the filter didn't already provide them, use user's
        if (userLocation?.latitude && userLocation?.longitude) {
          lat = lat || userLocation.latitude;
          lng = lng || userLocation.longitude;
        }
      }

      // 2. Build Venue-Specific Conditions
      if (country) venuesConditions.push(eq(venues.country, country));
      if (state) venuesConditions.push(eq(venues.state, state));

      // 3. Handle Advanced Filtering (Distance/Location)
      // Now uses 'lat' and 'lng' which could be from filters OR userId
      if (lat && lng && distance) {
        const distanceKm = parseDistanceToKm(distance);
        if (distanceKm && distanceKm <= 200) {
          const distanceCondition = buildDistanceCondition(lat, lng, distanceKm);
          if (distanceCondition) {
            const eventsWithDistance = await db
              .select({ id: events.id })
              .from(events)
              .innerJoin(venues, eq(events.venueId, venues.id))
              .where(and(...conditions, ...venuesConditions, distanceCondition));

            const eventIds = eventsWithDistance.map(e => e.id);
            if (eventIds.length === 0) return this.emptyPaginationResponse(page, limit);
            conditions.push(inArray(events.id, eventIds));
          }
        }
      } else if (location?.trim()) {
        const locationFilteredEvents = await db.query.events.findMany({
          where: and(...conditions),
          with: { venue: true },
        });

        const filteredEvents = filterEventsByLocation(locationFilteredEvents, location);
        const filteredIds = filteredEvents.map(e => e.id);

        if (filteredIds.length === 0) return this.emptyPaginationResponse(page, limit);
        conditions.push(inArray(events.id, filteredIds));
      }

      // 4. MAIN QUERY
      const [eventsResult, totalCount] = await Promise.all([
        db
          .select({
            event: events,
            venue: venues,
            organizer: organizers,
            group: groups,
            isLiked: sql`CASE WHEN ${eventLikes.id} IS NOT NULL THEN true ELSE false END`,
          })
          .from(events)
          .leftJoin(venues, eq(events.venueId, venues.id))
          .leftJoin(organizers, eq(events.organizerId, organizers.id))
          .leftJoin(groups, eq(events.groupId, groups.id))
          .leftJoin(users, eq(organizers.userId, users.id))
          .leftJoin(
            eventLikes,
            and(eq(eventLikes.eventId, events.id), eq(eventLikes.userId, userId))
          )
          .where(and(...conditions, ...venuesConditions))
          .orderBy(desc(events.createdAt))
          .limit(limit)
          .offset(offset),

        db
          .select({ count: count() })
          .from(events)
          .innerJoin(venues, eq(events.venueId, venues.id))
          .where(and(...conditions, ...venuesConditions)),
      ]);

      // 5. Format and Enhance
      const formattedEvents = eventsResult.map(row => ({
        ...row.event,
        venue: row.venue,
        organizer: row.organizer,
        group: row.group,
        isLiked: !!row.isLiked,
      }));

      // 6. Fetch and attach categories to all events
      await this.enrichEventsWithCategories(formattedEvents);

      // Passing the resolved lat/lng here ensures 'distance' key is generated
      const eventsWithPrices = await enhanceEventsData(formattedEvents, lat, lng, distance);

      for (const event of eventsWithPrices) {
        event.eventSessions = await EventScheduleService.getSchedulesByEventId(event.id);
      }

      await MediaModerationService.attachEventModerationStatuses(eventsWithPrices);

      const discoverFilterEnabled = await TextModerationService.getFilterEnabled(userId);
      await TextModerationService.maskFlaggedText(eventsWithPrices, {
        entityType: TEXT_ENTITY.EVENT,
        fields: ['title', 'description'],
        filterEnabled: discoverFilterEnabled,
      });

      return {
        events: eventsWithPrices,
        pagination: buildPaginationResponse(page, limit, totalCount[0].count),
      };
    } catch (error) {
      console.error('Get discover events error:', error);
      throw new ApiError(500, 'Failed to get discover events');
    }
  }
  // Helper to keep code clean
  static emptyPaginationResponse(page, limit) {
    return {
      events: [],
      pagination: { page, limit, total: 0, hasNext: false, hasPrev: page > 1 },
    };
  }

  //   static async getMyEvents(userId, filters) {
  //     try {
  //       const {
  //         page = 1,
  //         limit = 12,
  //         timeFilter = 'all',
  //         organizerId,
  //         location,
  //         dateRange,
  //         priceFilter,
  //         eventMode,
  //         lat,
  //         status,
  //         signedUp=false  ,
  //         liked,
  //         lng,
  //         distance,
  //       } = filters;
  //       const offset = (page - 1) * limit;

  //       let organizerEvents = [];
  //       let purchasedEvents = [];
  //       let now = new Date();
  //       // Get events created by organizer if organizerId is provided
  //       if (organizerId && signedUp === false) {
  //         let organizerConditions = [eq(events.organizerId, organizerId)];
  //         if (status) {
  //           organizerConditions.push(eq(events.eventStatus, status));
  //         }
  //         if (timeFilter === 'upcoming') {
  //           organizerConditions.push(gte(events.startDate, now));
  //         } else if (timeFilter === 'past') {
  //           organizerConditions.push(lte(events.endDate, now));
  //         }

  //         // Apply new filters to organizer events
  //         const dateConditions = buildDateConditions(timeFilter, dateRange);
  //         organizerConditions.push(...dateConditions);

  //         if (eventMode) {
  //           organizerConditions.push(eq(events.eventMode, eventMode));
  //         }

  //         const priceCondition = buildPriceConditions(priceFilter);
  //         if (priceCondition) {
  //           organizerConditions.push(priceCondition);
  //         }
  // console.log('Organizer event conditions:', organizerConditions);
  //         organizerEvents = await db.query.events.findMany({
  //           where: and(...organizerConditions),
  //           with: {
  //             venue: true,
  //             organizer: true,
  //           },
  //           orderBy: desc(events.createdAt),
  //         });

  //         // Apply location filters if needed
  //         if (lat && lng && distance) {
  //           const distanceKm = parseDistanceToKm(distance);
  //           if (distanceKm && distanceKm <= 200) {
  //             organizerEvents = organizerEvents.filter(event => {
  //               if (!event.venue?.latitude || !event.venue?.longitude) return false;
  //               const eventDistanceKm = calculateDistance(
  //                 lat,
  //                 lng,
  //                 event.venue.latitude,
  //                 event.venue.longitude
  //               );
  //               return eventDistanceKm <= distanceKm;
  //             });
  //           }
  //         } else if (location && typeof location === 'string' && location.trim()) {
  //           organizerEvents = filterEventsByLocation(organizerEvents, location);
  //         }
  //       }

  //       // Get events where user has purchased tickets

  //       const purchasedTicketsQuery = await db.query.purchasedTickets.findMany({
  //         where: eq(purchasedTickets.userId, userId),
  //         with: {
  //           event: {
  //             with: {
  //               venue: true,
  //               organizer: true,
  //             },
  //           },
  //         },
  //       });

  //       // Extract unique events from purchased tickets and apply filters
  //       const eventMap = new Map();
  //       purchasedTicketsQuery.forEach(ticket => {
  //         if (ticket.event && !eventMap.has(ticket.event.id)) {
  //           const event = ticket.event;

  //           // Apply time filter
  //           const eventStartDate = new Date(event.startDate);
  //           const eventEndDate = new Date(event.endDate);

  //           let includeEvent = true;
  //           if (timeFilter === 'upcoming' && eventStartDate <= now) {
  //             includeEvent = false;
  //           } else if (timeFilter === 'past' && eventEndDate > now) {
  //             includeEvent = false;
  //           }

  //           // Apply new filters
  //           if (includeEvent && eventMode && event.eventMode !== eventMode) {
  //             includeEvent = false;
  //           }

  //           if (includeEvent && priceFilter) {
  //             if (priceFilter === 'free' && !event.isFree) {
  //               includeEvent = false;
  //             } else if (priceFilter === 'paid' && event.isFree) {
  //               includeEvent = false;
  //             }
  //           }

  //           // Apply distance filter
  //           if (includeEvent && lat && lng && distance) {
  //             const distanceKm = parseDistanceToKm(distance);
  //             if (distanceKm && distanceKm <= 200) {
  //               if (!event.venue?.latitude || !event.venue?.longitude) {
  //                 includeEvent = false;
  //               } else {
  //                 const eventDistanceKm = calculateDistance(
  //                   lat,
  //                   lng,
  //                   event.venue.latitude,
  //                   event.venue.longitude
  //                 );
  //                 if (eventDistanceKm > distanceKm) {
  //                   includeEvent = false;
  //                 }
  //               }
  //             }
  //           } else if (includeEvent && location && typeof location === 'string' && location.trim()) {
  //             // Use helper function to check if event matches location
  //             const matchingEvents = filterEventsByLocation([event], location);
  //             if (matchingEvents.length === 0) {
  //               includeEvent = false;
  //             }
  //           }

  //           if (includeEvent) {
  //             eventMap.set(event.id, event);
  //           }
  //         }
  //       });

  //       purchasedEvents = Array.from(eventMap.values());

  //       // Combine and deduplicate events
  //       const allEventsMap = new Map();

  //       // Add organizer events
  //       organizerEvents.forEach(event => {
  //         allEventsMap.set(event.id, { ...event, isOrganizer: true });
  //       });

  //       // Add purchased events (mark if user is also organizer)
  //       purchasedEvents.forEach(event => {
  //         if (allEventsMap.has(event.id)) {
  //           allEventsMap.get(event.id).hasPurchased = true;
  //         } else {
  //           allEventsMap.set(event.id, { ...event, hasPurchased: true });
  //         }
  //       });

  //       let allEvents = Array.from(allEventsMap.values()).sort(
  //         (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  //       );

  //       // Fetch and attach categories to all events
  //       await this.enrichEventsWithCategories(allEvents);

  //       // Attach `isLiked` flag for this user using a LEFT JOIN on event_likes
  //       if (userId && allEvents.length > 0) {
  //         const eventIds = allEvents.map(e => e.id);
  //         const likedRows = await db
  //           .select({
  //             id: events.id,
  //             isLiked: sql`CASE WHEN ${eventLikes.userId} IS NOT NULL THEN true ELSE false END`,
  //           })
  //           .from(events)
  //           .leftJoin(
  //             eventLikes,
  //             and(eq(eventLikes.eventId, events.id), eq(eventLikes.userId, userId))
  //           )
  //           .where(inArray(events.id, eventIds));

  //         const likedMap = new Map(likedRows.map(r => [r.id, !!r.isLiked]));
  //         allEvents.forEach(event => {
  //           event.isLiked = !!likedMap.get(event.id);
  //         });

  //         // If `liked` filter is requested, return only liked events
  //         const likedFlag = liked === true || liked === 'true' || liked === '1' || liked === 1;
  //         if (likedFlag) {
  //           allEvents = allEvents.filter(e => e.isLiked);
  //         }
  //       }

  //       // Apply pagination
  //       const total = allEvents.length;
  //       const paginatedEvents = allEvents.slice(offset, offset + limit);

  //       // Add lowest ticket price and distance for each event
  //       const eventsWithPrices = await enhanceEventsData(paginatedEvents, lat, lng, distance);
  //       for (const event of eventsWithPrices) {
  //         event.eventSessions = await EventScheduleService.getSchedulesByEventId(event.id);
  //       }
  //       return {
  //         events: eventsWithPrices,
  //         pagination: buildPaginationResponse(page, limit, total),
  //       };
  //     } catch (error) {
  //       console.error('Get my events error:', error);
  //       throw new ApiError(500, 'Failed to get my events');
  //     }
  //   }

  static async getMyEvents(userId, filters) {
    try {
      const {
        page = 1,
        limit = 12,
        timeFilter = 'all',
        organizerId,
        location,
        dateRange,
        priceFilter,
        eventMode,
        lat,
        status,
        signedUp,
        liked,
        lng,
        distance,
      } = filters;

      const offset = (page - 1) * limit;
      let organizerEvents = [];
      let purchasedEvents = [];
      const now = new Date();

      /* ===================== ORGANIZER EVENTS ===================== */
      if (organizerId && signedUp === undefined) {
        let organizerConditions = [eq(events.organizerId, organizerId)];

        if (status !== undefined && status !== null) {
          organizerConditions.push(eq(events.eventStatus, status));
        }

        if (timeFilter === 'upcoming') {
          organizerConditions.push(gte(events.startDate, now));
        } else if (timeFilter === 'past') {
          organizerConditions.push(lte(events.endDate, now));
        }

        organizerConditions.push(...buildDateConditions(timeFilter, dateRange));

        if (eventMode) {
          organizerConditions.push(eq(events.eventMode, eventMode));
        }

        const priceCondition = buildPriceConditions(priceFilter);
        if (priceCondition) {
          organizerConditions.push(priceCondition);
        }

        organizerEvents = await db.query.events.findMany({
          where: and(...organizerConditions),
          with: {
            venue: true,
            organizer: true,
          },
          orderBy: desc(events.createdAt),
        });

        // Location filtering
        if (lat && lng && distance) {
          const distanceKm = parseDistanceToKm(distance);
          if (distanceKm && distanceKm <= 200) {
            organizerEvents = organizerEvents.filter(event => {
              if (!event.venue?.latitude || !event.venue?.longitude) return false;
              const eventDistanceKm = calculateDistance(
                lat,
                lng,
                event.venue.latitude,
                event.venue.longitude
              );
              return eventDistanceKm <= distanceKm;
            });
          }
        } else if (location && typeof location === 'string' && location.trim()) {
          organizerEvents = filterEventsByLocation(organizerEvents, location);
        }
      }

      /* ===================== PURCHASED EVENTS ===================== */
      const purchasedTicketsQuery = await db.query.purchasedTickets.findMany({
        where: and(eq(purchasedTickets.userId, userId), ne(purchasedTickets.status, 'refunded')),
        with: {
          event: {
            with: {
              venue: true,
              organizer: true,
            },
          },
        },
      });

      const eventMap = new Map();

      purchasedTicketsQuery.forEach(ticket => {
        if (ticket.event && !eventMap.has(ticket.event.id)) {
          const event = ticket.event;

          let includeEvent = true;

          if (timeFilter === 'upcoming' && new Date(event.startDate) <= now) {
            includeEvent = false;
          } else if (timeFilter === 'past' && new Date(event.endDate) > now) {
            includeEvent = false;
          }

          if (includeEvent && eventMode && event.eventMode !== eventMode) {
            includeEvent = false;
          }

          if (includeEvent && priceFilter) {
            if (priceFilter === 'free' && !event.isFree) includeEvent = false;
            if (priceFilter === 'paid' && event.isFree) includeEvent = false;
          }

          if (includeEvent && lat && lng && distance) {
            const distanceKm = parseDistanceToKm(distance);
            if (distanceKm && distanceKm <= 200) {
              if (!event.venue?.latitude || !event.venue?.longitude) {
                includeEvent = false;
              } else {
                const eventDistanceKm = calculateDistance(
                  lat,
                  lng,
                  event.venue.latitude,
                  event.venue.longitude
                );
                if (eventDistanceKm > distanceKm) includeEvent = false;
              }
            }
          } else if (includeEvent && location && typeof location === 'string' && location.trim()) {
            if (filterEventsByLocation([event], location).length === 0) {
              includeEvent = false;
            }
          }

          if (includeEvent) {
            eventMap.set(event.id, event);
          }
        }
      });

      purchasedEvents = Array.from(eventMap.values());

      /* ===================== MERGE EVENTS ===================== */
      const allEventsMap = new Map();

      organizerEvents.forEach(event => {
        allEventsMap.set(event.id, { ...event, isOrganizer: true });
      });

      purchasedEvents.forEach(event => {
        if (allEventsMap.has(event.id)) {
          allEventsMap.get(event.id).hasPurchased = true;
        } else {
          allEventsMap.set(event.id, { ...event, hasPurchased: true });
        }
      });

      let allEvents = Array.from(allEventsMap.values()).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );

      /* ===================== 🔥 FIX: DRAFT VISIBILITY RULE ===================== */
      // Purchased events are always published.
      // Draft events must be visible ONLY to organizers.
      if (status === 'draft') {
        allEvents = allEvents.filter(event => event.isOrganizer === true);
      }

      /* ===================== ENRICH DATA ===================== */
      await this.enrichEventsWithCategories(allEvents);

      if (userId && allEvents.length > 0) {
        const eventIds = allEvents.map(e => e.id);

        const likedRows = await db
          .select({
            id: events.id,
            isLiked: sql`CASE WHEN ${eventLikes.userId} IS NOT NULL THEN true ELSE false END`,
          })
          .from(events)
          .leftJoin(
            eventLikes,
            and(eq(eventLikes.eventId, events.id), eq(eventLikes.userId, userId))
          )
          .where(inArray(events.id, eventIds));

        const likedMap = new Map(likedRows.map(r => [r.id, !!r.isLiked]));

        allEvents.forEach(event => {
          event.isLiked = !!likedMap.get(event.id);
        });

        const likedFlag = liked === true || liked === 'true' || liked === '1' || liked === 1;
        if (likedFlag) {
          allEvents = allEvents.filter(e => e.isLiked);
        }
      }

      /* ===================== PAGINATION ===================== */
      const total = allEvents.length;
      const paginatedEvents = allEvents.slice(offset, offset + limit);

      const eventsWithPrices = await enhanceEventsData(paginatedEvents, lat, lng, distance);

      for (const event of eventsWithPrices) {
        event.eventSessions = await EventScheduleService.getSchedulesByEventId(event.id);
      }

      await MediaModerationService.attachEventModerationStatuses(eventsWithPrices);

      const myEventsFilterEnabled = await TextModerationService.getFilterEnabled(userId);
      await TextModerationService.maskFlaggedText(eventsWithPrices, {
        entityType: TEXT_ENTITY.EVENT,
        fields: ['title', 'description'],
        filterEnabled: myEventsFilterEnabled,
      });

      return {
        events: eventsWithPrices,
        pagination: buildPaginationResponse(page, limit, total),
      };
    } catch (error) {
      console.error('Get my events error:', error);
      throw new ApiError(500, 'Failed to get my events');
    }
  }

  static async getAccessibleEvents({
    userId = null,
    organizerId = null,
    roles = [],
    teamMemberId = null,
  } = {}) {
    try {
      const eventsMap = new Map();

      if (roles.includes('admin')) {
        const allEvents = await db.query.events.findMany({
          with: {
            venue: true,
            organizer: true,
          },
        });
        allEvents.forEach(event => eventsMap.set(event.id, event));
      }

      if (organizerId) {
        const organizerEvents = await db.query.events.findMany({
          where: eq(events.organizerId, organizerId),
          with: {
            venue: true,
            organizer: true,
          },
        });
        organizerEvents.forEach(event => eventsMap.set(event.id, event));
      }

      if (teamMemberId) {
        const member = await db.query.eventTeamMembers.findFirst({
          where: eq(eventTeamMembers.id, teamMemberId),
          with: {
            team: {
              with: {
                event: {
                  with: {
                    venue: true,
                    organizer: true,
                  },
                },
              },
            },
          },
        });

        if (member?.team?.event) {
          eventsMap.set(member.team.event.id, member.team.event);
        }
      }

      if (userId) {
        const userTeamMembers = await db.query.eventTeamMembers.findMany({
          where: eq(eventTeamMembers.userId, userId),
          with: {
            team: {
              with: {
                event: {
                  with: {
                    venue: true,
                    organizer: true,
                  },
                },
              },
            },
          },
        });

        userTeamMembers.forEach(member => {
          if (member?.team?.event) {
            eventsMap.set(member.team.event.id, member.team.event);
          }
        });
      }

      const accessibleEvents = Array.from(eventsMap.values());
      const accessibleFilterEnabled = await TextModerationService.getFilterEnabled(userId);
      await TextModerationService.maskFlaggedText(accessibleEvents, {
        entityType: TEXT_ENTITY.EVENT,
        fields: ['title', 'description'],
        filterEnabled: accessibleFilterEnabled,
      });
      return accessibleEvents;
    } catch (error) {
      console.error('Get accessible events error:', error);
      throw new ApiError(500, 'Failed to get accessible events');
    }
  }

  static async getMemberEvents({ userId = null, teamMemberId = null } = {}) {
    try {
      const conditions = [];
      if (userId) conditions.push(eq(eventTeamMembers.userId, userId));
      if (teamMemberId) conditions.push(eq(eventTeamMembers.id, teamMemberId));

      if (conditions.length === 0) {
        throw new ApiError(401, 'Authentication required to fetch member events');
      }

      const memberships = await db.query.eventTeamMembers.findMany({
        where: or(...conditions),
        with: {
          role: true,
          team: {
            with: {
              event: {
                with: {
                  venue: true,
                  organizer: true,
                },
              },
            },
          },
        },
      });

      const result = memberships
        .filter(m => m.team?.event)
        .map(m => {
          const { passwordHash, ...memberData } = m;
          return {
            member: memberData,
            team: m.team ? { ...m.team, event: undefined } : null,
            role: m.role || null,
            event: m.team?.event || null,
          };
        });

      const memberEventsFilterEnabled = await TextModerationService.getFilterEnabled(userId);
      await TextModerationService.maskFlaggedText(result.map(r => r.event).filter(Boolean), {
        entityType: TEXT_ENTITY.EVENT,
        fields: ['title', 'description'],
        filterEnabled: memberEventsFilterEnabled,
      });

      return result;
    } catch (error) {
      console.error('Get member events error:', error);
      throw new ApiError(500, 'Failed to get member events');
    }
  }

  static async getEventById(eventId, userId = null) {
    try {
      if (!eventId) {
        throw new ApiError(400, 'Event ID is required');
      }

      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        with: {
          venue: true,
          venueProfile: true,
          organizer: true,
          tickets: true,
          merchandise: true,
          media: true,
          preset: true,
        },
      });

      if (!event) {
        throw new ApiError(404, 'Event not found');
      }

      // Hide media whose backing file was rejected/removed by moderation
      // (kept items get moderationStatus for frontend blur)
      if (event.media?.length) {
        event.media = await MediaModerationService.stripRejectedMedia(event.media, m => m.mediaUrl);
      }
      // Event-level status (covers) — drives sales-paused banner + ticket fallback
      event.moderationStatus = await MediaModerationService.statusOf(MEDIA_ENTITY.EVENT, event.id);

      const eventFilterEnabled = await TextModerationService.getFilterEnabled(userId);
      await TextModerationService.maskFlaggedTextSingle(event, {
        entityType: TEXT_ENTITY.EVENT,
        fields: ['title', 'description'],
        filterEnabled: eventFilterEnabled,
      });

      // Fetch and attach categories to event
      await this.enrichEventsWithCategories([event]);

      // Fetch event sessions
      const sessions = await EventScheduleService.getSchedulesByEventId(eventId);

      // Add shouldShowReviewPrompt flag if userId is provided
      let shouldShowReviewPrompt = false;
      if (userId) {
        shouldShowReviewPrompt = await ReviewService.shouldShowReviewPrompt(userId, eventId);
      }

      // Add lowest ticket price
      let lowestTicketPrice = '0.00';
      if (!event.isFree && event.tickets && event.tickets.length > 0) {
        const prices = event.tickets.map(ticket => parseFloat(ticket.price));
        lowestTicketPrice = Math.min(...prices).toFixed(2);
      }

      // If userId provided, add purchasedByUser for each ticket tier
      let ticketsWithUserCounts = event.tickets;
      if (userId && event.tickets && event.tickets.length > 0) {
        const ticketTierIds = event.tickets.map(t => t.id);
        try {
          const userTicketCounts = await getUserTicketCountsForTiers(userId, ticketTierIds);

          ticketsWithUserCounts = event.tickets.map(ticket => ({
            ...ticket,
            purchasedByUser: userTicketCounts.get(ticket.id) || 0,
          }));
        } catch (err) {
          // If helper fails for any reason, don't block the response — log and continue without counts
          console.error('Failed to fetch user ticket counts:', err);
          ticketsWithUserCounts = event.tickets.map(ticket => ({
            ...ticket,
            purchasedByUser: 0,
          }));
        }
      }
      const createdBy = await getUserInformation(event.organizer.userId);
      let organizerRating = { averageRating: 0, totalReviews: 0 };
      if (event.organizer?.id) {
        const ratingQuery = await db
          .select({
            avgRating: avg(eventReviews.overallRating),
            totalReviews: count(eventReviews.id),
          })
          .from(events)
          .leftJoin(eventReviews, eq(events.id, eventReviews.eventId))
          .where(eq(events.organizerId, event.organizer.id));

        organizerRating = {
          averageRating: parseFloat(ratingQuery[0]?.avgRating || 0),
          totalReviews: ratingQuery[0]?.totalReviews || 0,
        };
      }
      // For virtual events, show only basic info (no sensitive details like links/passwords)
      // Sensitive details are only available through purchased tickets
      const virtualDetails =
        event.eventMode === 'virtual'
          ? await VirtualDetailsService.getBasicVirtualDetails(eventId)
          : null;

      let ticketsWithSessionInventory = ticketsWithUserCounts;
      if (ticketsWithUserCounts.length > 0) {
        const ticketTierIds = ticketsWithUserCounts.map(t => t.id);
        const allSessionInventory = await db.query.eventTicketScheduleInventory.findMany({
          where: inArray(eventTicketScheduleInventory.ticketTierId, ticketTierIds),
        });

        ticketsWithSessionInventory = ticketsWithUserCounts.map(ticket => {
          const rows = allSessionInventory.filter(r => r.ticketTierId === ticket.id);
          const sessionInventory = {};
          for (const row of rows) {
            const remaining = Math.max(0, row.quantityAvailable - row.quantitySold);
            sessionInventory[row.scheduleId] = {
              quantityAvailable: row.quantityAvailable,
              quantitySold: row.quantitySold,
              remaining,
              isSoldOut: remaining === 0,
            };
          }
          return { ...ticket, sessionInventory };
        });
      }

      return {
        ...event,
        expired: dayjs(event.endDate).isBefore(dayjs()),
        tickets: ticketsWithSessionInventory,
        sessions,
        lowestTicketPrice,
        shouldShowReviewPrompt,
        createdBy,
        virtualDetails,
        activePreset: event.preset ?? null,
        organizer: event.organizer ? { ...event.organizer, ...organizerRating } : event.organizer,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Get event by ID error:', error);
      throw new ApiError(500, 'Failed to get event');
    }
  }

  static async getEventBySlug(slug, userId = null) {
    try {
      if (!slug) {
        throw new ApiError(400, 'Event slug is required');
      }

      const event = await db.query.events.findFirst({
        where: eq(events.slug, slug),
      });

      if (!event) {
        throw new ApiError(404, 'Event not found');
      }

      // Reuse getEventById for full event data
      return this.getEventById(event.id, userId);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Get event by slug error:', error);
      throw new ApiError(500, 'Failed to get event');
    }
  }

static async updateEvent(eventId, eventData, { isAdmin = false } = {}) {
    try {
      const {
        organizerId,
        tickets,
        merchandise,
        media,
        sessions,
        virtualDetails,
        venueProfile,
        ...updateData
      } = eventData;

      if (!isAdmin && !organizerId) {
        throw new ApiError(400, 'Organizer ID is required');
      }

      // Admins can edit any event; organizers only their own
      const existingEvent = await db.query.events.findFirst({
        where: isAdmin
          ? eq(events.id, eventId)
          : and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
        with: {
          media: true,
        },
      });

      if (!existingEvent) {
        throw new ApiError(404, 'Event not found or unauthorized');
      }

      // Admin edits carry no organizerId in the payload — resolve it from the event
      const effectiveOrganizerId = isAdmin ? existingEvent.organizerId : organizerId;

      const oldStartDate = existingEvent.startDate;
      const oldEndDate = existingEvent.endDate;
      const oldVenueId = existingEvent.venueId;

      // Handle coverImages replacement - clean up old images
      if (updateData.coverImages !== undefined) {
        try {
          const oldCoverImages = existingEvent.coverImages || [];
          const newCoverImages = updateData.coverImages || [];

          // Find images that are being removed
          const removedImages = oldCoverImages.filter(oldUrl => !newCoverImages.includes(oldUrl));

          // Decrement reference for removed images
          for (const imageUrl of removedImages) {
            const file = await FileManagementService.findByUrlOrKey(imageUrl);
            if (file) {
              await FileManagementService.decrementReference(file.id);
            }
          }
        } catch (cleanupError) {
          console.error('Error cleaning up old cover images:', cleanupError);
          // Continue with update even if cleanup fails
        }
      }

      // Filter out undefined values and prepare update data
      const processedEventData = {};

      if (updateData.title !== undefined) {
        processedEventData.title = updateData.title;
        if (updateData.title !== existingEvent.title) {
          const baseSlug = slugify(updateData.title, { lower: true, strict: true });
          processedEventData.slug = await generateUniqueSlug(baseSlug);
        }
      }
      if (updateData.description !== undefined)
        processedEventData.description = updateData.description;
      if (updateData.categoryIds !== undefined)
        processedEventData.categoryIds = updateData.categoryIds;
      if (updateData.venueId !== undefined) processedEventData.venueId = updateData.venueId;
      if (updateData.eventType !== undefined) processedEventData.eventType = updateData.eventType;
      if (updateData.eventStatus !== undefined)
        processedEventData.eventStatus = updateData.eventStatus;
      if (updateData.isFree !== undefined) processedEventData.isFree = updateData.isFree;
      if (updateData.capacity !== undefined) processedEventData.capacity = updateData.capacity;
      if (updateData.coverImages !== undefined)
        processedEventData.coverImages = updateData.coverImages;
      if (updateData.attendReason !== undefined)
        processedEventData.attendReason = updateData.attendReason;
      if (updateData.eventHighlights !== undefined)
        processedEventData.eventHighlights = updateData.eventHighlights;
      if (updateData.showAttendeeCount !== undefined)
        processedEventData.showAttendeeCount = updateData.showAttendeeCount;
      if (updateData.youtubeVideoUrl !== undefined)
        processedEventData.youtubeVideoUrl = updateData.youtubeVideoUrl;
      if (updateData.isChatEnabled !== undefined)
        processedEventData.isChatEnabled = updateData.isChatEnabled;
      if (updateData.isRefundable !== undefined)
        processedEventData.isRefundable = updateData.isRefundable;
      if (updateData.refundPolicy !== undefined)
        processedEventData.refundPolicy = updateData.refundPolicy;
      if (updateData.showLikeCount !== undefined)
        processedEventData.showLikeCount = updateData.showLikeCount;
      if (updateData.youtubeVideoUrl !== undefined)
        processedEventData.youtubeVideoUrl = updateData.youtubeVideoUrl;
      if (updateData.platformFeePercentage !== undefined) {
        const parsed = parseFloat(updateData.platformFeePercentage);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
          processedEventData.platformFeePercentage = parsed;
        }
      }
      if (updateData.showTicketsRemaining !== undefined)
        processedEventData.showTicketsRemaining = updateData.showTicketsRemaining;
      // Note: startDate and endDate are managed by event sessions, not manually updated

      processedEventData.updatedAt = new Date();

      const eventTextEntries = [
        ['title', processedEventData.title],
        ['description', processedEventData.description],
      ].filter(([, value]) => typeof value === 'string' && value.trim());

      let eventModeration = { action: 'keep' };
      if (eventTextEntries.length > 0) {
        eventModeration = await TextModerationService.assertAllowed({
          entityType: TEXT_ENTITY.EVENT,
          entityId: eventId,
          entityCreatorId: effectiveOrganizerId || eventId,
          texts: eventTextEntries.map(([, value]) => value),
        });
      }

      const [updatedEvent] = await db
        .update(events)
        .set(processedEventData)
        .where(eq(events.id, eventId))
        .returning();

      await TextModerationService.recordIfFlagged(eventModeration, {
        entityType: TEXT_ENTITY.EVENT,
        entityId: eventId,
        userId: null,
        fieldNames: eventTextEntries.map(([name]) => name),
        texts: eventTextEntries.map(([, value]) => value),
      });

      // Recompute cover moderation — replacing a rejected cover unblocks
      // sales automatically (self-healing)
      await MediaModerationService.adoptMediaVerdicts({
        entityType: MEDIA_ENTITY.EVENT,
        entityId: eventId,
        userId: null,
        ...MediaModerationService.splitUrls(updatedEvent?.coverImages),
      });

      if (processedEventData.eventStatus === 'published' && !existingEvent.snsTopicArn) {
        try {
          await createAndStoreTopic(eventId, existingEvent.title);
        } catch (snsError) {
          console.error('Failed to create SNS topic on event publish:', snsError);
        }
      } else if (
        processedEventData.eventStatus &&
        ['cancelled', 'ended'].includes(processedEventData.eventStatus) &&
        existingEvent.snsTopicArn
      ) {
        try {
          await deleteEventTopic(existingEvent.snsTopicArn);
          await db.update(events).set({ snsTopicArn: null }).where(eq(events.id, eventId));
        } catch (snsError) {
          console.error('Failed to delete SNS topic on event end:', snsError);
        }
      }

      if (venueProfile !== undefined || updateData.venueId !== undefined) {
        const targetVenueId = updateData.venueId ?? updatedEvent.venueId;
        if (targetVenueId) {
          const profilePatch = {};
          if (venueProfile) {
            if (venueProfile.description !== undefined)
              profilePatch.description = venueProfile.description;
            if (venueProfile.capacity !== undefined) profilePatch.capacity = venueProfile.capacity;
            if (venueProfile.amenities !== undefined)
              profilePatch.amenities = venueProfile.amenities;
            if (venueProfile.additionalInformation !== undefined)
              profilePatch.additionalInformation = venueProfile.additionalInformation;
            if (venueProfile.cancellationPolicy !== undefined)
              profilePatch.cancellationPolicy = venueProfile.cancellationPolicy;
            if (venueProfile.accessibility !== undefined)
              profilePatch.accessibility = venueProfile.accessibility;
            if (venueProfile.contactEmail !== undefined)
              profilePatch.contactEmail = venueProfile.contactEmail;
            if (venueProfile.contactPhone !== undefined)
              profilePatch.contactPhone = venueProfile.contactPhone;
            if (venueProfile.parkingInfo !== undefined)
              profilePatch.parkingInfo = venueProfile.parkingInfo;
            if (venueProfile.publicTransportInfo !== undefined)
              profilePatch.publicTransportInfo = venueProfile.publicTransportInfo;
            if (venueProfile.emoji !== undefined) profilePatch.emoji = venueProfile.emoji;
          }

          await db
            .insert(eventVenueProfiles)
            .values({
              eventId,
              venueId: targetVenueId,
              ...profilePatch,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: eventVenueProfiles.eventId,
              set: { ...profilePatch, venueId: targetVenueId, updatedAt: new Date() },
            });
        }
      }

      // Update tickets if provided - PRESERVE existing ticket IDs to maintain user purchases
      if (tickets !== undefined && tickets.length > 0) {
        // Get all existing tickets for this event
        const existingTickets = await db.query.eventTickets.findMany({
          where: eq(eventTickets.eventId, eventId),
        });

        const existingTicketMap = new Map(existingTickets.map(t => [t.id, t]));
        const newTicketIds = new Set();

               for (const ticket of tickets) {
          if (ticket.id && existingTicketMap.has(ticket.id)) {
            const existingTicket = existingTicketMap.get(ticket.id);
            const {
              id,
              quantitySold,
              quantityAvailable,
              isSoldOut,
              sessionInventory,
              ...ticketWithoutId
            } = ticket;

            await db
              .update(eventTickets)
              .set({
                ...ticketWithoutId,
                salesStart: new Date(ticket.salesStart),
                salesEnd: new Date(ticket.salesEnd),
                updatedAt: new Date(),
              })
              .where(eq(eventTickets.id, ticket.id));

            // Allow capacity change from the edit form, but keep it in sync
            // with per-session inventory rows and never below what's sold.
            if (
              quantityAvailable !== undefined &&
              Number(quantityAvailable) !== existingTicket.quantityAvailable
            ) {
              const newQty = Number(quantityAvailable);
              if (isNaN(newQty) || newQty < 0) {
                throw new ApiError(
                  400,
                  `Invalid quantityAvailable for ticket "${existingTicket.name}"`
                );
              }
              if (newQty < existingTicket.quantitySold) {
                throw new ApiError(
                  400,
                  `Cannot set capacity for "${existingTicket.name}" to ${newQty} — ${existingTicket.quantitySold} already sold`
                );
              }

              const sessionRows = await db.query.eventTicketScheduleInventory.findMany({
                where: eq(eventTicketScheduleInventory.ticketTierId, ticket.id),
              });

              if (sessionRows.length > 0) {
                const delta = newQty - existingTicket.quantityAvailable;
                // Single-session events: just set it directly.
                if (sessionRows.length === 1) {
                  const row = sessionRows[0];
                  const rowNewQty = row.quantityAvailable + delta;
                  if (rowNewQty < row.quantitySold) {
                    throw new ApiError(
                      400,
                      `Cannot reduce capacity for "${existingTicket.name}" below ${row.quantitySold} tickets already sold for this session`
                    );
                  }
                  await db
                    .update(eventTicketScheduleInventory)
                    .set({ quantityAvailable: rowNewQty, updatedAt: new Date() })
                    .where(eq(eventTicketScheduleInventory.id, row.id));
                } else {
                  // Multi-session events: capacity must be adjusted per-session
                  // via updateSessionInventory, since we can't guess the split.
                  throw new ApiError(
                    400,
                    `"${existingTicket.name}" has multiple sessions — update capacity per session instead of on the event form`
                  );
                }
              } else {
                // No session inventory rows exist at all for this tier — safe to set directly.
                await db
                  .update(eventTickets)
                  .set({ quantityAvailable: newQty, updatedAt: new Date() })
                  .where(eq(eventTickets.id, ticket.id));
              }
            }

            newTicketIds.add(ticket.id);
          } else {
            // Create new ticket (no ID provided or ID doesn't exist)
            const { id, ...ticketWithoutId } = ticket;
            const ticketCode = generateTicketCode();
            const [newTicket] = await db
              .insert(eventTickets)
              .values({
                ...ticketWithoutId,
                ticketCode,
                eventId,
                salesStart: new Date(ticket.salesStart),
                salesEnd: new Date(ticket.salesEnd),
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            newTicketIds.add(newTicket.id);
            // Create inventory rows for this new ticket across all existing sessions
            const schedulesForNewTicket = await db.query.eventSchedules.findMany({
              where: and(eq(eventSchedules.eventId, eventId), isNull(eventSchedules.deletedAt)),
            });
            if (schedulesForNewTicket.length > 0) {
              const qtyPerSession = newTicket.quantityAvailable;
              await db
                .insert(eventTicketScheduleInventory)
                .values(
                  schedulesForNewTicket.map(schedule => ({
                    eventId,
                    ticketTierId: newTicket.id,
                    scheduleId: schedule.id,
                    quantityAvailable: qtyPerSession,
                    quantitySold: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  }))
                )
                .onConflictDoNothing();
            }
          }
        }

        // Delete only tickets that have no purchases (to prevent orphaning purchased tickets)
        const ticketsWithPurchases = await db
          .select({ ticketTierId: purchasedTickets.ticketTierId })
          .from(purchasedTickets)
          .where(eq(purchasedTickets.eventId, eventId));

        const purchasedTicketIds = new Set(ticketsWithPurchases.map(p => p.ticketTierId));

        // Only delete tickets that are not in the new list AND have no purchases
        for (const [ticketId, _] of existingTicketMap) {
          if (!newTicketIds.has(ticketId) && !purchasedTicketIds.has(ticketId)) {
            await db.delete(eventTickets).where(eq(eventTickets.id, ticketId));
          }
        }
      }

      // Update merchandise if provided
      if (merchandise !== undefined && merchandise.length > 0) {
        // Get all existing merchandise for this event
        const existingMerchandise = await db.query.eventMerchandise.findMany({
          where: eq(eventMerchandise.eventId, eventId),
        });

        const existingMerchMap = new Map(existingMerchandise.map(m => [m.id, m]));
        const newMerchIds = new Set();

        // Process each merchandise item
        for (const item of merchandise) {
          if (item.id && existingMerchMap.has(item.id)) {
            // Update existing merchandise
            const { id, ...itemWithoutId } = item;
            await db
              .update(eventMerchandise)
              .set({
                ...itemWithoutId,
                updatedAt: new Date(),
              })
              .where(eq(eventMerchandise.id, item.id));
            newMerchIds.add(item.id);
          } else {
            // Create new merchandise
            const { id, ...itemWithoutId } = item;
            const [newMerch] = await db
              .insert(eventMerchandise)
              .values({
                ...itemWithoutId,
                eventId,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            newMerchIds.add(newMerch.id);
          }
        }

        // Delete only merchandise with no purchases
        const merchandiseWithPurchases = await db
          .select({ merchandiseId: purchasedMerchandise.merchandiseId })
          .from(purchasedMerchandise)
          .where(eq(purchasedMerchandise.eventId, eventId));

        const purchasedMerchIds = new Set(merchandiseWithPurchases.map(p => p.merchandiseId));

        // Only delete merchandise that is not in the new list AND has no purchases
        for (const [merchId, _] of existingMerchMap) {
          if (!newMerchIds.has(merchId) && !purchasedMerchIds.has(merchId)) {
            await db.delete(eventMerchandise).where(eq(eventMerchandise.id, merchId));
          }
        }
      }

      // Update media if provided
      if (media !== undefined && media.length > 0) {
        // Get organizer's userId
        const organizer = await db.query.organizers.findFirst({
          where: eq(organizers.id, existingEvent.organizerId),
        });

        // Clean up old event media files before replacing
        try {
          if (existingEvent.eventMedia && existingEvent.eventMedia.length > 0) {
            for (const oldMedia of existingEvent.eventMedia) {
              const file = await FileManagementService.findByUrlOrKey(oldMedia.mediaUrl);
              if (file) {
                await FileManagementService.decrementReference(file.id);
              }
            }
          }
        } catch (cleanupError) {
          console.error('Error cleaning up old event media:', cleanupError);
          // Continue with update even if cleanup fails
        }

        // For media, we can safely replace since it doesn't have user purchases
        await db.delete(eventMedia).where(eq(eventMedia.eventId, eventId));

        const mediaData = media.map(item => ({
          eventId,
          uploaderId: organizer?.userId || existingEvent.organizerId,
          mediaUrl: item.url,
          mediaType: item.type,
          caption: item.caption || null,
          createdAt: new Date(),
        }));
        await db.insert(eventMedia).values(mediaData);

        const oldGalleryUrls = new Set((existingEvent.eventMedia || []).map(m => m.mediaUrl));
        await this.notifyGalleryMediaVerdicts(
          media.map(item => item.url).filter(url => !oldGalleryUrls.has(url))
        );
      }

      // Update sessions if provided
      if (sessions !== undefined && sessions.length > 0) {
        // Get all existing sessions for this event
        const existingSchedules = await db.query.eventSchedules.findMany({
          where: and(eq(eventSchedules.eventId, eventId), isNull(eventSchedules.deletedAt)),
        });

        const existingScheduleMap = new Map(existingSchedules.map(s => [s.id, s]));
        const processedScheduleIds = new Set();

        // Process each session in the update
        for (const session of sessions) {
          if (session.id && existingScheduleMap.has(session.id)) {
            // Update existing session using EventScheduleService
            const { id, ...sessionUpdate } = session;
            await EventScheduleService.updateSchedule(session.id, sessionUpdate);
            processedScheduleIds.add(session.id);
          } else {
            // Create new session(s) using EventScheduleService
            // Remove id if it exists (frontend-generated)
            const { id, ...sessionWithoutId } = session;
            const newSessions = await EventScheduleService.createEventSessions(
              eventId,
              updatedEvent.title,
              updatedEvent.description,
              [sessionWithoutId]
            );
            // Track the newly created session IDs
            newSessions.forEach(s => processedScheduleIds.add(s.id));

            const ticketsForNewSession = await db.query.eventTickets.findMany({
              where: eq(eventTickets.eventId, eventId),
            });
            if (ticketsForNewSession.length > 0 && newSessions.length > 0) {
              const invRows = newSessions.flatMap(newSession =>
                ticketsForNewSession.map(ticket => ({
                  eventId,
                  ticketTierId: ticket.id,
                  scheduleId: newSession.id,
                  quantityAvailable: ticket.quantityAvailable,
                  quantitySold: 0,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                }))
              );
              await db.insert(eventTicketScheduleInventory).values(invRows).onConflictDoNothing();
            }
          }
        }

        // Delete sessions that are not in the update list (only if they have no tickets sold)
        for (const [scheduleId, schedule] of existingScheduleMap) {
          if (!processedScheduleIds.has(scheduleId)) {
            // Only delete if no tickets have been sold for this session
            if (schedule.ticketsSold === 0) {
              await EventScheduleService.deleteSchedule(scheduleId);
            } else {
              console.warn(
                `Cannot delete schedule ${scheduleId} - ${schedule.ticketsSold} tickets already sold`
              );
            }
          }
        }
      }

      // Update virtual details if provided (also syncs with existing tickets)
      if (virtualDetails !== undefined) {
        await VirtualDetailsService.updateVirtualDetails(eventId, virtualDetails);
      }

      const finalEvent = await this.getEventById(updatedEvent.id);

      if (existingEvent.eventStatus === 'published') {
        const dateChanged =
          new Date(finalEvent.startDate).getTime() !== new Date(oldStartDate).getTime() ||
          new Date(finalEvent.endDate).getTime() !== new Date(oldEndDate).getTime();
        const venueChanged = finalEvent.venueId !== oldVenueId;

        if (dateChanged || venueChanged) {
          const holderRows = await db
            .select({ userId: users.id, email: users.email, firstName: users.firstName })
            .from(purchasedTickets)
            .innerJoin(users, eq(purchasedTickets.userId, users.id))
            .where(
              and(eq(purchasedTickets.eventId, eventId), eq(purchasedTickets.status, 'active'))
            )
            .groupBy(users.id, users.email, users.firstName);

          if (holderRows.length > 0) {
            const venue = finalEvent.venue ?? null;
            const organizerName = finalEvent.organizer?.businessName ?? 'The Organizer';

            const notifTitle =
              dateChanged && venueChanged
                ? `Event date & venue updated: ${finalEvent.title}`
                : dateChanged
                  ? `Event rescheduled: ${finalEvent.title}`
                  : `Venue changed: ${finalEvent.title}`;

            const notifMessage =
              dateChanged && venueChanged
                ? `The date and venue for "${finalEvent.title}" have been updated. Please check the new details.`
                : dateChanged
                  ? `"${finalEvent.title}" has been rescheduled to ${new Date(finalEvent.startDate).toLocaleString()}.`
                  : `The venue for "${finalEvent.title}" has been updated. Please check the new location.`;

            const emailRecipients = holderRows
              .filter(r => r.email)
              .map(r => ({ email: r.email, name: r.firstName || 'there' }));

            const bulkEmailFn =
              dateChanged && venueChanged
                ? () =>
                    sendEventDateAndVenueChangedEmail(
                      emailRecipients,
                      finalEvent,
                      venue,
                      organizerName
                    )
                : dateChanged
                  ? () => sendEventRescheduledEmail(emailRecipients, finalEvent, organizerName)
                  : () =>
                      sendEventVenueChangedEmail(emailRecipients, finalEvent, venue, organizerName);

            const notifTasks = holderRows.map(r =>
              createNotification({
                userId: r.userId,
                title: notifTitle,
                message: notifMessage,
                type: 'event_update',
                relatedId: eventId,
                redirectTo: `/events/${finalEvent.slug}`,
                metadata: {
                  eventId,
                  eventTitle: finalEvent.title,
                  organizerLogoUrl: finalEvent.organizer?.logoUrl ?? null,
                },
              })
            );

            if (emailRecipients.length > 0) {
              bulkEmailFn().catch(err =>
                console.error('Failed to send event update bulk emails:', err)
              );
            }

            Promise.allSettled(notifTasks).catch(err =>
              console.error('Failed to create event update notifications:', err)
            );
          }
        }
      }

      return finalEvent;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Event update error:', error);
      throw new ApiError(500, 'Failed to update event');
    }
  }

  static async deleteEvent(eventId, userId) {
    const organizer = await OrganizerService.getOrganizerProfile(userId);
    const existingEvent = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, organizer?.id)),
      with: {
        media: true,
      },
    });

    if (!existingEvent) {
      throw new ApiError(404, 'Event not found or unauthorized');
    }

    // Clean up media files before deletion
    try {
      // Handle event cover images
      if (existingEvent.coverImages && Array.isArray(existingEvent.coverImages)) {
        for (const imageUrl of existingEvent.coverImages) {
          const file = await FileManagementService.findByUrlOrKey(imageUrl);
          if (file) {
            await FileManagementService.decrementReference(file.id);
          }
        }
      }

      // Handle event media
      if (existingEvent.eventMedia && existingEvent.eventMedia.length > 0) {
        for (const media of existingEvent.eventMedia) {
          const file = await FileManagementService.findByUrlOrKey(media.mediaUrl);
          if (file) {
            await FileManagementService.decrementReference(file.id);
          }
        }
      }
    } catch (cleanupError) {
      console.error('Error cleaning up event media files:', cleanupError);
      // Continue with deletion even if cleanup fails
    }

    if (existingEvent.snsTopicArn) {
      try {
        await deleteEventTopic(existingEvent.snsTopicArn);
      } catch (snsError) {
        console.error('Failed to delete SNS topic for event:', snsError);
      }
    }

    await db.delete(events).where(eq(events.id, eventId));
  }

  static async cancelEvent(eventId, userId, { reason = '' } = {}) {
    const organizer = await OrganizerService.getOrganizerProfile(userId);
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, organizer?.id)),
    });

    if (!event) throw new ApiError(404, 'Event not found or unauthorized');
    if (event.eventStatus === 'cancelled') throw new ApiError(400, 'Event already cancelled');

    // 1. Mark event cancelled
    await db
      .update(events)
      .set({
        eventStatus: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason || null,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId));

    // 2. Fetch all paid orders for this event
    const paidOrders = await db.query.orders.findMany({
      where: and(eq(orders.eventId, eventId), inArray(orders.status, ['completed', 'paid'])),
    });

    // 3. Full refunds — transfer reversed from organizer, platform keeps fees
    const refundResults = await RefundService.issueEventCancellationRefunds(paidOrders, event);

    // 4. Hold pending organizer payouts to cover refund exposure
    if (organizer?.id) {
      await db
        .update(organizerPayouts)
        .set({ status: 'held', updatedAt: new Date() })
        .where(
          and(
            eq(organizerPayouts.organizerId, organizer.id),
            inArray(organizerPayouts.status, ['pending', 'approved'])
          )
        );
    }

    // 5. Email all unique ticket holders
    const uniqueUserIds = [...new Set(paidOrders.map(o => o.userId))];
    const cancelledEvent = {
      ...event,
      eventStatus: 'cancelled',
      cancellationReason: reason || null,
    };
    for (const uid of uniqueUserIds) {
      try {
        const user = await db.query.users.findFirst({ where: eq(users.id, uid) });
        if (user?.email) {
          await sendEventCancellationEmail(user.email, cancelledEvent);
        }
      } catch (emailErr) {
        console.error(`Cancellation email failed for user ${uid}:`, emailErr.message);
      }
    }

    return { event: cancelledEvent, refundResults };
  }

  static async publishEvent(eventId, userId) {
    const organizer = await db.query.organizers.findFirst({
      where: eq(organizers.userId, userId),
    });

    if (!organizer) {
      throw new ApiError(403, 'Organizer profile required to publish events');
    }

    // ── Moderation gates: an event with removed cover content, or a
    // title/description that violates guidelines, stays drafted ─────────────
    const draft = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, organizer.id)),
      columns: { id: true, title: true, description: true },
    });
    if (!draft) throw new ApiError(404, 'Event not found or unauthorized');

    const mediaStatus = await MediaModerationService.statusOf(MEDIA_ENTITY.EVENT, eventId);
    if (mediaStatus === 'rejected') {
      throw new ApiError(
        422,
        'This event cannot be published — an image was removed for violating our community guidelines. Replace it and try again.',
        true,
        '',
        { code: 'EVENT_CONTENT_PAUSED' }
      );
    }

    const publishModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.EVENT,
      entityId: eventId,
      entityCreatorId: userId,
      texts: [draft.title, draft.description],
    });

    const [updatedEvent] = await db
      .update(events)
      .set({
        eventStatus: 'published',
        updatedAt: new Date(),
      })
      .where(and(eq(events.id, eventId), eq(events.organizerId, organizer.id)))
      .returning();

    if (!updatedEvent) {
      throw new ApiError(404, 'Event not found or unauthorized');
    }

    await TextModerationService.recordIfFlagged(publishModeration, {
      entityType: TEXT_ENTITY.EVENT,
      entityId: eventId,
      userId,
      fieldNames: ['title', 'description'],
      texts: [draft.title, draft.description],
    });

    // ... rest of the method unchanged
  }
  static async getEventAnalytics(eventId, userId) {
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, userId)),
    });

    if (!event) {
      throw new ApiError(404, 'Event not found or unauthorized');
    }

    const ticketsSold = await db
      .select({ count: count() })
      .from(purchasedTickets)
      .where(and(eq(purchasedTickets.eventId, eventId), ne(purchasedTickets.status, 'refunded')));

    return {
      event,
      ticketsSold: ticketsSold[0].count,
    };
  }

  static async getEventTickets(eventId, userId = null) {
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { showTicketsRemaining: true },
    });

    const tickets = await db.query.eventTickets.findMany({
      where: eq(eventTickets.eventId, eventId),
      orderBy: asc(eventTickets.price),
    });

    if (userId && tickets.length > 0) {
      const ticketTierIds = tickets.map(ticket => ticket.id);
      const userTicketCounts = await getUserTicketCountsForTiers(userId, ticketTierIds);

      return tickets.map(({ quantityAvailable, quantitySold, ...ticket }) => ({
        ...ticket,
        // Only expose remaining count if organizer opted in
        ...(event?.showTicketsRemaining && { quantityAvailable, quantitySold }),
        purchasedByUser: userTicketCounts.get(ticket.id) || 0,
      }));
    }

    return tickets.map(({ quantityAvailable, quantitySold, ...ticket }) => ({
      ...ticket,
      ...(event?.showTicketsRemaining && { quantityAvailable, quantitySold }),
    }));
  }
  static async joinEvent(userId, eventData) {
    try {
      const {
        eventId,
        holderName,
        holderPhone,
        holderEmail,
        quantity = 1,
        eventScheduleId,
        trackingLinkId,
      } = eventData;

      const event = await this.getEventById(eventId);
      if (!event) {
        throw new ApiError(404, 'Event not found');
      }

      if (event.eventStatus === 'cancelled') {
        throw new ApiError(400, 'This event has been cancelled');
      }

      if (!event.isFree) {
        throw new ApiError(400, 'This is not a free event');
      }

      // Registrations paused while the event has removed cover content
      if ((await MediaModerationService.statusOf(MEDIA_ENTITY.EVENT, eventId)) === 'rejected') {
        throw new ApiError(
          403,
          'Registrations for this event are paused due to a content violation.',
          true,
          '',
          { code: 'EVENT_CONTENT_PAUSED' }
        );
      }

      let scheduleInfo = null;
      if (eventScheduleId) {
        scheduleInfo = await EventScheduleService.validateScheduleCapacity(
          eventScheduleId,
          quantity
        );

        if (scheduleInfo.eventId !== eventId) {
          throw new ApiError(400, 'Schedule does not belong to this event');
        }
      }

      // Check capacity
      if (event.capacity) {
        const currentAttendees = await db
          .select({ count: count() })
          .from(purchasedTickets)
          .where(eq(purchasedTickets.eventId, eventId));

        if (currentAttendees[0].count + quantity > event.capacity) {
          throw new ApiError(400, 'Event capacity exceeded');
        }
      }

      // Allow multiple joins for quantity selection
      const existingTickets = await db.query.purchasedTickets.findMany({
        where: and(eq(purchasedTickets.eventId, eventId), eq(purchasedTickets.userId, userId)),
      });

      const maxTickets = 10;
      const totalTicketsAfterJoin = existingTickets.length + quantity;

      if (totalTicketsAfterJoin > maxTickets) {
        throw new ApiError(
          400,
          `You cannot have more than ${maxTickets} tickets for this event. You currently have ${existingTickets.length}.`
        );
      }

      // Get or create a default free ticket tier for this event
      let freeTicketTier = await db.query.eventTickets.findFirst({
        where: and(eq(eventTickets.eventId, eventId), eq(eventTickets.price, '0.00')),
      });

      if (!freeTicketTier) {
        // Create a default free ticket tier
        const ticketCode = generateTicketCode();
        const [newTicketTier] = await db
          .insert(eventTickets)
          .values({
            ticketCode,
            eventId,
            name: 'Free Admission',
            description: 'Free event ticket',
            price: '0.00',
            quantityAvailable: event.capacity || 999999,
            quantitySold: 0,
            salesStart: new Date(),
            salesEnd: new Date(event.endDate),
            minTicketsPerOrder: 1,
            maxTicketsPerOrder: quantity,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        freeTicketTier = newTicketTier;
      }

      // Create tickets for free event
      const tickets = [];
      for (let i = 0; i < quantity; i++) {
        const ticketCode = generateTicketCode();
        const qrCodeData = {
          eventId,
          organizerId: event.organizerId,
          ticketCode,
          ticketTierId: freeTicketTier.id,
          eventScheduleId: eventScheduleId || null,
          sessionDate: scheduleInfo ? scheduleInfo.startTime : null,
          sessionStartTime: scheduleInfo ? scheduleInfo.startTime : null,
          sessionEndTime: scheduleInfo ? scheduleInfo.endTime : null,
          holderName,
          price: '0.00',
          eventStartDate: event.startDate,
          isUsed: false,
          usedAt: null,
        };
        const qrCode = JSON.stringify(qrCodeData);

        const [ticket] = await db
          .insert(purchasedTickets)
          .values({
            ticketCode,
            eventId,
            ticketTierId: freeTicketTier.id,
            eventScheduleId: eventScheduleId || null, // Add eventScheduleId
            userId,
            organizerId: event.organizerId,
            holderName,
            holderPhone,
            holderEmail,
            price: '0.00',
            trackingLinkId: trackingLinkId || null,
            qrCode,
            status: 'active',
            purchasedAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        // Generate QR image and upload (best-effort)
        try {
          const pngBuffer = await QRCode.toBuffer(qrCode, {
            type: 'png',
            width: 300,
            errorCorrectionLevel: 'M',
          });
          const fileObj = {
            originalname: `${ticket.ticketCode}.png`,
            buffer: pngBuffer,
            mimetype: 'image/png',
            size: pngBuffer.length,
          };
          const uploadRes = await UploadService.uploadFile(fileObj, 'tickets', ticket.id);
          await db
            .update(purchasedTickets)
            .set({
              qrCodeUrl: uploadRes.url,
              qrImageS3Key: uploadRes.s3Key,
              updatedAt: new Date(),
            })
            .where(eq(purchasedTickets.id, ticket.id));
        } catch (err) {
          console.error('Failed to generate/upload QR image for ticket', ticket.id, err);
        }

        tickets.push(ticket);
      }

      if (eventScheduleId) {
        await EventScheduleService.incrementTicketsSold(eventScheduleId, quantity);
      }

      // Update the free ticket tier sold count
      await db
        .update(eventTickets)
        .set({
          quantitySold: freeTicketTier.quantitySold + quantity,
          updatedAt: new Date(),
        })
        .where(eq(eventTickets.id, freeTicketTier.id));

      // Add user to event chat if event is published
      if (event.eventStatus === 'published') {
        try {
          const chatRoom = await EventChatService.createEventChatRoom(eventId);
          await EventChatService.addParticipant(chatRoom.id, userId, 'participant');
        } catch (chatError) {
          console.error('Failed to add user to event chat:', chatError);
          // Don't fail the join if chat fails
        }
      }

      return { tickets, event };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Join event error:', error);
      throw new ApiError(500, 'Failed to join event');
    }
  }

  static async purchaseTickets(userId, purchaseData) {
    try {
      const {
        eventId,
        ticketSelections,
        merchandiseSelections = [],
        holderName,
        holderPhone,
        holderEmail,
        eventScheduleId, // Add eventScheduleId from purchase data
        trackingLinkId,
      } = purchaseData;

      const event = await this.getEventById(eventId);
      if (!event) {
        throw new ApiError(404, 'Event not found');
      }

      if (event.eventStatus === 'cancelled') {
        throw new ApiError(400, 'This event has been cancelled');
      }

      if (event.isFree) {
        throw new ApiError(400, 'This is a free event, use join instead');
      }

      // Validate tracking link if provided
      if (trackingLinkId) {
        const link = await TrackingLinkService.findById(trackingLinkId);
        if (!link || link.eventId !== eventId || !link.enabled) {
          throw new ApiError(400, 'Invalid tracking link');
        }
      }

      let totalTickets = 0;
      let totalAmount = 0;
      const tickets = [];
      const merchandise = [];

      // Validate ticket selections and calculate totals
      for (const selection of ticketSelections) {
        const ticketTier = await db.query.eventTickets.findFirst({
          where: and(
            eq(eventTickets.id, selection.ticketTierId),
            eq(eventTickets.eventId, eventId)
          ),
        });

        if (!ticketTier) {
          throw new ApiError(404, `Ticket tier not found: ${selection.ticketTierId}`);
        }

        // Check if user already has tickets for this tier
        const userExistingTicketCount = await getUserTicketCountForTier(
          userId,
          selection.ticketTierId
        );

        // Validate maxTicketsPerOrder limit
        if (ticketTier.maxTicketsPerOrder) {
          const totalUserTickets = userExistingTicketCount + selection.quantity;
          if (totalUserTickets > ticketTier.maxTicketsPerOrder) {
            throw new ApiError(
              400,
              `You can only purchase a maximum of ${ticketTier.maxTicketsPerOrder} tickets for "${
                ticketTier.name
              }". You already have ${userExistingTicketCount} ticket(s), so you can only buy ${
                ticketTier.maxTicketsPerOrder - userExistingTicketCount
              } more.`
            );
          }
        }

        // Validate minTicketsPerOrder limit
        if (ticketTier.minTicketsPerOrder && selection.quantity < ticketTier.minTicketsPerOrder) {
          throw new ApiError(
            400,
            `You must purchase at least ${ticketTier.minTicketsPerOrder} tickets for "${ticketTier.name}"`
          );
        }

        if (eventScheduleId) {
          // Check session-specific inventory
          const sessionInventory = await db.query.eventTicketScheduleInventory.findFirst({
            where: and(
              eq(eventTicketScheduleInventory.ticketTierId, selection.ticketTierId),
              eq(eventTicketScheduleInventory.scheduleId, eventScheduleId)
            ),
          });

          if (!sessionInventory) {
            throw new ApiError(400, `No inventory found for ${ticketTier.name} on this session`);
          }

          const sessionRemaining =
            sessionInventory.quantityAvailable - sessionInventory.quantitySold;
          if (selection.quantity > sessionRemaining) {
            throw new ApiError(
              400,
              `Only ${sessionRemaining} tickets available for ${ticketTier.name} on this session`
            );
          }
        } else {
          // Fallback: global check
          if (ticketTier.quantitySold + selection.quantity > ticketTier.quantityAvailable) {
            throw new ApiError(400, `Not enough tickets available for ${ticketTier.name}`);
          }
        }

        totalTickets += selection.quantity;
        totalAmount += parseFloat(ticketTier.price) * selection.quantity;
      }

      let scheduleInfo = null;
      if (eventScheduleId) {
        scheduleInfo = await EventScheduleService.validateScheduleCapacity(
          eventScheduleId,
          totalTickets
        );

        if (scheduleInfo.eventId !== eventId) {
          throw new ApiError(400, 'Schedule does not belong to this event');
        }
      }

      // Validate merchandise selections and calculate totals
      for (const selection of merchandiseSelections) {
        const merchandiseItem = await db.query.eventMerchandise.findFirst({
          where: and(
            eq(eventMerchandise.id, selection.merchandiseId),
            eq(eventMerchandise.eventId, eventId)
          ),
        });

        if (!merchandiseItem) {
          throw new ApiError(404, `Merchandise item not found: ${selection.merchandiseId}`);
        }

        if (selection.quantity > merchandiseItem.quantityAvailable) {
          throw new ApiError(400, `Not enough stock available for ${merchandiseItem.name}`);
        }

        totalAmount += parseFloat(merchandiseItem.price) * selection.quantity;
      }

      // Check event capacity
      if (event.capacity) {
        const currentAttendees = await db
          .select({ count: count() })
          .from(purchasedTickets)
          .where(eq(purchasedTickets.eventId, eventId));

        if (currentAttendees[0].count + totalTickets > event.capacity) {
          throw new ApiError(400, 'Event capacity exceeded');
        }
      }

      // Create purchased tickets
      for (const selection of ticketSelections) {
        const ticketTier = await db.query.eventTickets.findFirst({
          where: eq(eventTickets.id, selection.ticketTierId),
        });

        for (let i = 0; i < selection.quantity; i++) {
          const ticketCode = generateTicketCode();
          const qrCodeData = {
            eventId,
            organizerId: event.organizerId,
            ticketCode,
            ticketTierId: selection.ticketTierId,
            eventScheduleId: eventScheduleId || null,
            sessionDate: scheduleInfo ? scheduleInfo.startTime : null,
            sessionStartTime: scheduleInfo ? scheduleInfo.startTime : null,
            sessionEndTime: scheduleInfo ? scheduleInfo.endTime : null,
            holderName,
            price: ticketTier.price,
            eventStartDate: event.startDate,
            isUsed: false,
            usedAt: null,
          };
          const qrCode = JSON.stringify(qrCodeData);

          const [ticket] = await db
            .insert(purchasedTickets)
            .values({
              ticketCode,
              eventId,
              ticketTierId: selection.ticketTierId,
              eventScheduleId: eventScheduleId || null,
              userId,
              organizerId: event.organizerId,
              holderName,
              holderPhone,
              holderEmail,
              price: ticketTier.price,
              trackingLinkId: trackingLinkId || null,
              qrCode,
              status: 'active',
              purchasedAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          // Generate QR image and upload (best-effort)
          try {
            const pngBuffer = await QRCode.toBuffer(qrCode, {
              type: 'png',
              width: 300,
              errorCorrectionLevel: 'M',
            });
            const fileObj = {
              originalname: `${ticket.ticketCode}.png`,
              buffer: pngBuffer,
              mimetype: 'image/png',
              size: pngBuffer.length,
            };
            const uploadRes = await UploadService.uploadFile(fileObj, 'tickets', ticket.id);
            await db
              .update(purchasedTickets)
              .set({
                qrCodeUrl: uploadRes.url,
                qrImageS3Key: uploadRes.s3Key,
                updatedAt: new Date(),
              })
              .where(eq(purchasedTickets.id, ticket.id));
          } catch (err) {
            console.error('Failed to generate/upload QR image for ticket', ticket.id, err);
          }

          tickets.push(ticket);
        }
        // Sync eventTickets.quantitySold total
        await db
          .update(eventTickets)
          .set({
            quantitySold: sql`${eventTickets.quantitySold} + ${selection.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(eventTickets.id, selection.ticketTierId));

        // Update session inventory atomically
        if (eventScheduleId) {
          const sessionUpdateResult = await db
            .update(eventTicketScheduleInventory)
            .set({
              quantitySold: sql`${eventTicketScheduleInventory.quantitySold} + ${selection.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(eventTicketScheduleInventory.ticketTierId, selection.ticketTierId),
                eq(eventTicketScheduleInventory.scheduleId, eventScheduleId),
                sql`(${eventTicketScheduleInventory.quantityAvailable} - ${eventTicketScheduleInventory.quantitySold}) >= ${selection.quantity}`
              )
            )
            .returning();

          if (sessionUpdateResult.length === 0) {
            throw new ApiError(
              400,
              `Not enough session tickets available for tier ${selection.ticketTierId}`
            );
          }
        }
      }

      if (eventScheduleId) {
        await EventScheduleService.incrementTicketsSold(eventScheduleId, totalTickets);
      }

      // Create purchased merchandise
      for (const selection of merchandiseSelections) {
        const merchandiseItem = await db.query.eventMerchandise.findFirst({
          where: eq(eventMerchandise.id, selection.merchandiseId),
        });

        const merchandiseCode = generateTicketCode(); // Reuse code generator
        const unitPrice = parseFloat(merchandiseItem.price);
        const totalPrice = unitPrice * selection.quantity;

        const [purchasedItem] = await db
          .insert(purchasedMerchandise)
          .values({
            merchandiseCode,
            eventId,
            merchandiseId: selection.merchandiseId,
            userId,
            organizerId: event.organizerId,
            holderName,
            holderPhone,
            holderEmail,
            quantity: selection.quantity,
            unitPrice: unitPrice.toString(),
            totalPrice: totalPrice.toString(),
            status: 'active',
            purchasedAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        merchandise.push(purchasedItem);

        // Update merchandise stock
        await db
          .update(eventMerchandise)
          .set({
            quantityAvailable: merchandiseItem.quantityAvailable - selection.quantity,
            updatedAt: new Date(),
          })
          .where(eq(eventMerchandise.id, selection.merchandiseId));
      }

      // Add user to event chat if event is published
      if (event.eventStatus === 'published') {
        try {
          const chatRoom = await EventChatService.createEventChatRoom(eventId);
          await EventChatService.addParticipant(chatRoom.id, userId, 'participant');
        } catch (chatError) {
          console.error('Failed to add user to event chat:', chatError);
          // Don't fail the ticket purchase if chat fails
        }
      }

      // Send ticket purchase email to user
      try {
        if (holderEmail && event && event.venue && tickets.length > 0) {
          const downloadUrl = `${process.env.API_HOST || 'https://gokyro.com'}/tickets/user`;
          await sendTicketPurchaseEmail(holderEmail, event, tickets, event.venue, downloadUrl);
        }
      } catch (mailError) {
        console.error('Failed to send ticket purchase email:', mailError);
      }

      return { tickets, merchandise, event, totalAmount };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Purchase tickets error:', error);
      throw new ApiError(500, 'Failed to purchase tickets');
    }
  }

  static async getUserEventStatus(userId, eventId) {
    try {
      const userTickets = await db.query.purchasedTickets.findMany({
        where: and(
          eq(purchasedTickets.eventId, eventId),
          eq(purchasedTickets.userId, userId),
          ne(purchasedTickets.status, 'refunded')
        ),
      });
      const virtualDetails = await VirtualDetailsService.getVirtualDetails(eventId);
      return {
        hasJoined: userTickets.length > 0,
        ticketCount: userTickets.length,
        virtualDetails,
        tickets: userTickets,
      };
    } catch (error) {
      console.error('Get user event status error:', error);
      throw new ApiError(500, 'Failed  to get user event status');
    }
  }

  // ─── TICKET TIER SALES ──────────────────────────────────────────────────────

  static async startTicketSale(
    organizerId,
    eventId,
    ticketTierId,
    { discountPercent, startDate, endDate }
  ) {
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
      columns: { id: true },
    });
    if (!event) throw new ApiError(404, 'Event not found or not owned by this organizer');

    const tier = await db.query.eventTickets.findFirst({
      where: and(eq(eventTickets.id, ticketTierId), eq(eventTickets.eventId, eventId)),
    });
    if (!tier) throw new ApiError(404, 'Ticket tier not found');

    const discount = parseFloat(discountPercent);
    if (isNaN(discount) || discount <= 0 || discount > 60) {
      throw new ApiError(400, 'Discount must be between 1% and 60%');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      throw new ApiError(400, 'Invalid sale dates: end must be after start');
    }

    const [updated] = await db
      .update(eventTickets)
      .set({
        saleDiscountPercent: discount.toFixed(2),
        saleStartDate: start,
        saleEndDate: end,
        isSaleActive: true,
        updatedAt: new Date(),
      })
      .where(eq(eventTickets.id, ticketTierId))
      .returning();

    const salePrice = parseFloat((parseFloat(tier.price) * (1 - discount / 100)).toFixed(2));
    return { ...updated, salePrice };
  }

  static async endTicketSale(organizerId, eventId, ticketTierId) {
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
      columns: { id: true },
    });
    if (!event) throw new ApiError(404, 'Event not found or not owned by this organizer');

    const tier = await db.query.eventTickets.findFirst({
      where: and(eq(eventTickets.id, ticketTierId), eq(eventTickets.eventId, eventId)),
      columns: { id: true },
    });
    if (!tier) throw new ApiError(404, 'Ticket tier not found');

    const [updated] = await db
      .update(eventTickets)
      .set({
        isSaleActive: false,
        saleDiscountPercent: null,
        saleStartDate: null,
        saleEndDate: null,
        updatedAt: new Date(),
      })
      .where(eq(eventTickets.id, ticketTierId))
      .returning();

    return updated;
  }

  static async getEventTicketSales(organizerId, eventId) {
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
      columns: { id: true },
    });
    if (!event) throw new ApiError(404, 'Event not found or not owned by this organizer');

    const tiers = await db.query.eventTickets.findMany({
      where: eq(eventTickets.eventId, eventId),
      columns: {
        id: true,
        name: true,
        price: true,
        isSaleActive: true,
        saleDiscountPercent: true,
        saleStartDate: true,
        saleEndDate: true,
      },
    });

    const now = new Date();
    return tiers.map(t => {
      const isLive =
        t.isSaleActive &&
        t.saleStartDate &&
        t.saleEndDate &&
        now >= new Date(t.saleStartDate) &&
        now <= new Date(t.saleEndDate);
      const salePrice = isLive
        ? parseFloat(
            (parseFloat(t.price) * (1 - parseFloat(t.saleDiscountPercent) / 100)).toFixed(2)
          )
        : null;
      return {
        ...t,
        saleStatus: !t.isSaleActive
          ? 'none'
          : isLive
            ? 'active'
            : now < new Date(t.saleStartDate)
              ? 'scheduled'
              : 'ended',
        salePrice,
      };
    });
  }

  static async updateSessionInventory(organizerId, eventId, ticketTierId, rows, { isAdmin = false } = {}) {
  const event = await db.query.events.findFirst({
    where: isAdmin
      ? eq(events.id, eventId)
      : and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
    columns: { id: true },
  });
  if (!event) throw new ApiError(404, 'Event not found or not owned by this organizer');

  const tier = await db.query.eventTickets.findFirst({
    where: and(eq(eventTickets.id, ticketTierId), eq(eventTickets.eventId, eventId)),
  });
  if (!tier) throw new ApiError(404, 'Ticket tier not found');

    const existingRows = await db.query.eventTicketScheduleInventory.findMany({
      where: eq(eventTicketScheduleInventory.ticketTierId, ticketTierId),
    });
    const existingMap = new Map(existingRows.map(r => [r.scheduleId, r]));

    const updated = [];

    for (const row of rows) {
      const { scheduleId, quantityAvailable } = row;

      if (!scheduleId) throw new ApiError(400, 'Each row must have a scheduleId');

      const newQty = Number(quantityAvailable);
      if (isNaN(newQty) || newQty < 0) {
        throw new ApiError(400, `Invalid quantityAvailable for schedule ${scheduleId}`);
      }
      const schedule = await db.query.eventSchedules.findFirst({
        where: and(
          eq(eventSchedules.id, scheduleId),
          eq(eventSchedules.eventId, eventId),
          isNull(eventSchedules.deletedAt)
        ),
        columns: { id: true },
      });
      if (!schedule) {
        throw new ApiError(400, `Schedule ${scheduleId} not found for this event`);
      }

      const existing = existingMap.get(scheduleId);
      const soldSoFar = existing?.quantitySold ?? 0;
      if (newQty < soldSoFar) {
        throw new ApiError(
          400,
          `Cannot set slots to ${newQty} for this session — ${soldSoFar} tickets already sold`
        );
      }

      if (existing) {
        const [result] = await db
          .update(eventTicketScheduleInventory)
          .set({ quantityAvailable: newQty, updatedAt: new Date() })
          .where(
            and(
              eq(eventTicketScheduleInventory.ticketTierId, ticketTierId),
              eq(eventTicketScheduleInventory.scheduleId, scheduleId)
            )
          )
          .returning();
        updated.push(result);
      } else {
        const [result] = await db
          .insert(eventTicketScheduleInventory)
          .values({
            eventId,
            ticketTierId,
            scheduleId,
            quantityAvailable: newQty,
            quantitySold: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        updated.push(result);
      }
    }

    const allSessionRows = await db.query.eventTicketScheduleInventory.findMany({
      where: eq(eventTicketScheduleInventory.ticketTierId, ticketTierId),
    });
    const newTierTotal = allSessionRows.reduce((s, r) => s + (r.quantityAvailable ?? 0), 0);
    const newTierSold = allSessionRows.reduce((s, r) => s + (r.quantitySold ?? 0), 0);

    await db
      .update(eventTickets)
      .set({
        quantityAvailable: newTierTotal,

        updatedAt: new Date(),
      })
      .where(eq(eventTickets.id, ticketTierId));

    return {
      updated,
      tierTotal: newTierTotal,
      tierSold: newTierSold,
      tierRemaining: newTierTotal - newTierSold,
    };
  }
}
