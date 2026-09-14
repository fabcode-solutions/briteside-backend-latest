import { db } from '../db/index.js';
import {
  purchasedTickets,
  guestPurchasedTickets,
  guestOrders,
  events,
  eventTickets,
  eventSchedules,
  users,
} from '../db/schema/index.js';
import { eq, and, inArray, or, ilike, count, desc, ne, sql, isNull } from 'drizzle-orm';
import { getUserById, findByEmail, findByPhone } from './user.service.js';
import { generateTicketCode } from '../utils/code-generator.js';
import QRCode from 'qrcode';
import { UploadService } from './upload.service.js';
import ApiError from '../utils/api-error.js';
import { sendTicketPurchaseEmail } from './eventMail.helper.js';
import { EventScheduleService } from './eventSchedule.service.js';
import { VirtualDetailsService } from './virtualDetails.service.js';
import { subscribeWithRetry } from '../utils/aws.util.js';
import { eventTicketScheduleInventory } from '../db/schema/events.js';
/**
 * Shared formatter that shapes a flat DB row into the standard ticket-sale
 * response object. The order processing fee and the 5% platform fee are both
 * charged once per order (see orders.platformShareCents), not per ticket, so
 * neither can be attributed to an individual ticket row here — `price` is the
 * base amount for this ticket.
 */
function formatTicketRow(row) {
  return {
    id: row.id,
    ticketCode: row.ticketCode,
    purchasedAt: row.purchasedAt,
    quantity: 1,
    price: row.price,
    holderName: row.holderName,
    holderEmail: row.holderEmail,
    holderPhone: row.holderPhone,
    status: row.status,
    isUsed: row.isUsed,
    usedAt: row.usedAt,
    qrCodeUrl: row.qrCodeUrl,
    ticketTier: { id: row.tierId, name: row.tierName, price: row.tierPrice },
    event: { id: row.eventId, title: row.eventTitle },
    buyer: {
      id: row.buyerUserId,
      firstName: row.buyerFirstName,
      lastName: row.buyerLastName,
      email: row.buyerEmail,
      phoneNumber: row.buyerPhone,
    },
  };
}

export class TicketService {
  static async purchaseTickets(userId, purchaseData) {
    const tickets = [];
    let event = null;
    let venue = null;
    let userEmail = null;
    let downloadUrl = null;

    for (const purchase of purchaseData) {
      const { eventId, ticketTierId, quantity, holderName, holderEmail, holderPhone } = purchase;

      let eventScheduleId = purchase.eventScheduleId || null;
      if (!eventScheduleId) {
        const allSchedules = await db.query.eventSchedules.findMany({
          where: and(eq(eventSchedules.eventId, eventId), isNull(eventSchedules.deletedAt)),
          columns: { id: true },
        });
        if (allSchedules.length === 1) {
          eventScheduleId = allSchedules[0].id;
        }
      }

      const eventInfo = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        with: {
          tickets: {
            where: eq(eventTickets.id, ticketTierId),
          },
          venue: true,
        },
      });

      if (!eventInfo) throw new ApiError(404, 'Event not found');
      if (eventInfo.eventStatus === 'cancelled')
        throw new ApiError(400, 'This event has been cancelled');

      const ticketTier = eventInfo.tickets[0];
      if (!ticketTier) throw new ApiError(404, 'Ticket tier not found');

      let scheduleInfo = null;
      let virtualDetails = null;

      if (eventInfo.eventMode === 'virtual') {
        virtualDetails = await VirtualDetailsService.getVirtualDetails(eventId);
      }

      if (eventScheduleId) {
        scheduleInfo = await EventScheduleService.validateScheduleCapacity(
          eventScheduleId,
          quantity
        );
        if (scheduleInfo.eventId !== eventId) {
          throw new ApiError(400, 'Schedule does not belong to this event');
        }
      }

      // Atomically reserve inventory BEFORE inserting tickets
      if (eventScheduleId) {
        const sessionUpdateResult = await db
          .update(eventTicketScheduleInventory)
          .set({
            quantitySold: sql`${eventTicketScheduleInventory.quantitySold} + ${quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(eventTicketScheduleInventory.ticketTierId, ticketTierId),
              eq(eventTicketScheduleInventory.scheduleId, eventScheduleId),
              sql`(${eventTicketScheduleInventory.quantityAvailable} - ${eventTicketScheduleInventory.quantitySold}) >= ${quantity}`
            )
          )
          .returning();

        if (sessionUpdateResult.length === 0) {
          throw new ApiError(
            400,
            `Not enough tickets available for ${ticketTier.name} on this session`
          );
        }
      } else {
        const ticketUpdateResult = await db
          .update(eventTickets)
          .set({
            quantitySold: sql`${eventTickets.quantitySold} + ${quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(eventTickets.id, ticketTierId),
              sql`(${eventTickets.quantityAvailable} - ${eventTickets.quantitySold}) >= ${quantity}`
            )
          )
          .returning();

        if (ticketUpdateResult.length === 0) {
          throw new ApiError(400, `Not enough tickets available for ${ticketTier.name}`);
        }
      }

      const groupDealSize = ticketTier.groupDealSize
        ? parseInt(ticketTier.groupDealSize, 10)
        : null;
      if (groupDealSize && quantity % groupDealSize !== 0) {
        throw new ApiError(
          400,
          `"${ticketTier.name}" is a group deal: quantity must be a multiple of ${groupDealSize}. Got ${quantity}.`
        );
      }

      for (let i = 0; i < quantity; i++) {
        const ticketCode = generateTicketCode();

        const [ticket] = await db
          .insert(purchasedTickets)
          .values({
            ticketCode,
            eventId,
            ticketTierId,
            eventScheduleId: eventScheduleId || null,
            userId,
            organizerId: eventInfo.organizerId,
            holderName,
            holderEmail,
            holderPhone,
            price: ticketTier.price,
            qrCode: ticketCode,
            purchasedAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        if (eventInfo.snsTopicArn && holderPhone) {
          try {
            const subscriptionArn = await subscribeWithRetry(eventInfo.snsTopicArn, holderPhone);
            await db
              .update(purchasedTickets)
              .set({ snsSubscriptionArn: subscriptionArn })
              .where(eq(purchasedTickets.id, ticket.id));
          } catch (snsError) {
            console.error('Failed to subscribe ticket holder to SNS topic:', snsError);
          }
        }

        try {
          const qrCodeData = {
            eventId,
            organizerId: eventInfo.organizerId,
            ticketCode,
            ticketTierId,
            eventScheduleId: eventScheduleId || null,
            sessionDate: scheduleInfo ? scheduleInfo.startTime : null,
            sessionStartTime: scheduleInfo ? scheduleInfo.startTime : null,
            sessionEndTime: scheduleInfo ? scheduleInfo.endTime : null,
            holderName: holderName || null,
            price: ticketTier.price,
            eventStartDate: eventInfo.startDate,
            isUsed: false,
            usedAt: null,
            orderId: null,
            virtualDetails: virtualDetails
              ? {
                  virtualPlatform: virtualDetails.virtualPlatform,
                  platformName: virtualDetails.platformName,
                  meetingLink: virtualDetails.meetingLink,
                  briteVideoLink: virtualDetails.briteVideoLink,
                  password: virtualDetails.password,
                  accessInstructions: virtualDetails.accessInstructions,
                }
              : null,
          };

          await db
            .update(purchasedTickets)
            .set({ qrCode: JSON.stringify(qrCodeData), updatedAt: new Date() })
            .where(eq(purchasedTickets.id, ticket.id));

          const pngBuffer = await QRCode.toBuffer(JSON.stringify(qrCodeData), {
            type: 'png',
            width: 300,
            errorCorrectionLevel: 'M',
          });
          const uploadRes = await UploadService.uploadFile(
            {
              originalname: `${ticket.ticketCode}.png`,
              buffer: pngBuffer,
              mimetype: 'image/png',
              size: pngBuffer.length,
            },
            'tickets',
            ticket.id
          );
          await db
            .update(purchasedTickets)
            .set({ qrCodeUrl: uploadRes.url, qrImageS3Key: uploadRes.s3Key, updatedAt: new Date() })
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
          quantitySold: sql`${eventTickets.quantitySold} + ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(eventTickets.id, ticketTierId));

      if (eventScheduleId) {
        await EventScheduleService.incrementTicketsSold(eventScheduleId, quantity);
      }

      event = eventInfo;
      venue = eventInfo.venue;
      userEmail = holderEmail;
      downloadUrl = `${process.env.API_HOST || 'https://gokyro.com'}/tickets/user`;
    }

    try {
      if (userEmail && event && venue && tickets.length > 0) {
        await sendTicketPurchaseEmail(userEmail, event, tickets, venue, downloadUrl);
      }
    } catch (mailError) {
      console.error('Failed to send ticket purchase email:', mailError);
    }

    return { tickets, event };
  }

  static async verifyTicket(verificationData) {
    const { ticketCode, eventId } = verificationData;

    const ticket = await db.query.purchasedTickets.findFirst({
      where: and(
        eq(purchasedTickets.ticketCode, ticketCode),
        eq(purchasedTickets.eventId, eventId)
      ),
      with: {
        event: true,
        user: true,
        ticketTier: true,
      },
    });

    if (!ticket) {
      throw new ApiError(404, 'Ticket not found');
    }

    return {
      valid: true,
      ticket,
      holder: {
        name: ticket.holderName,
        email: ticket.holderEmail,
        phone: ticket.holderPhone,
      },
    };
  }

  static async getUserTickets(userId, { status } = {}) {
    const statusFilter = status
      ? eq(purchasedTickets.status, status)
      : ne(purchasedTickets.status, 'refunded');

    const tickets = await db.query.purchasedTickets.findMany({
      where: and(eq(purchasedTickets.userId, userId), statusFilter),
      with: {
        ticketTier: true,
      },
      orderBy: (t, { desc }) => [desc(t.purchasedAt)],
    });

    if (tickets.length === 0) return [];
    const eventIds = [...new Set(tickets.map(t => t.eventId).filter(Boolean))];
    const eventRows = await db.query.events.findMany({
      where: inArray(events.id, eventIds),
      with: {
        venue: true,
      },
    });
    const virtualDetailsMap = {};
    for (const eventId of eventIds) {
      try {
        const vd = await VirtualDetailsService.getVirtualDetails(eventId);
        if (vd) virtualDetailsMap[eventId] = vd;
      } catch {}
    }
    const eventMap = {};
    for (const ev of eventRows) {
      eventMap[ev.id] = {
        ...ev,
        virtualDetails: virtualDetailsMap[ev.id] ?? null,
      };
    }
    return tickets.map(ticket => ({
      ...ticket,
      event: eventMap[ticket.eventId] ?? null,
    }));
  }

  /**
   * Get all sold tickets for a specific event owned by the organizer.
   * Includes full buyer info, tier info, and computed fee breakdown.
   */
  static async getOrganizerEventTickets(
    organizerId,
    eventId,
    filters = {},
    { isAdmin = false } = {}
  ) {
    const { search, page = 1, limit = 20 } = filters;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    // Verify the event belongs to this organizer (skip for admin)
    if (!isAdmin) {
      const eventOwnership = await db.query.events.findFirst({
        where: and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
        columns: { id: true },
      });
      if (!eventOwnership) {
        throw new ApiError(404, 'Event not found or not owned by this organizer');
      }
    }

    const conditions = [
      eq(purchasedTickets.eventId, eventId),
      ne(purchasedTickets.status, 'refunded'),
    ];
    if (organizerId) {
      conditions.push(eq(purchasedTickets.organizerId, organizerId));
    }

    if (search) {
      conditions.push(
        or(
          ilike(purchasedTickets.holderName, `%${search}%`),
          ilike(purchasedTickets.holderEmail, `%${search}%`),
          ilike(purchasedTickets.holderPhone, `%${search}%`)
        )
      );
    }

    const whereClause = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id: purchasedTickets.id,
          ticketCode: purchasedTickets.ticketCode,
          purchasedAt: purchasedTickets.purchasedAt,
          price: purchasedTickets.price,
          holderName: purchasedTickets.holderName,
          holderEmail: purchasedTickets.holderEmail,
          holderPhone: purchasedTickets.holderPhone,
          status: purchasedTickets.status,
          isUsed: purchasedTickets.isUsed,
          usedAt: purchasedTickets.usedAt,
          qrCodeUrl: purchasedTickets.qrCodeUrl,
          tierId: eventTickets.id,
          tierName: eventTickets.name,
          tierPrice: eventTickets.price,
          eventId: events.id,
          eventTitle: events.title,
          platformFeePercentage: events.platformFeePercentage,
          buyerUserId: users.id,
          buyerFirstName: users.firstName,
          buyerLastName: users.lastName,
          buyerEmail: users.email,
          buyerPhone: users.phoneNumber,
        })
        .from(purchasedTickets)
        .leftJoin(eventTickets, eq(purchasedTickets.ticketTierId, eventTickets.id))
        .leftJoin(events, eq(purchasedTickets.eventId, events.id))
        .leftJoin(users, eq(purchasedTickets.userId, users.id))
        .where(whereClause)
        .orderBy(desc(purchasedTickets.purchasedAt))
        .limit(limitNum)
        .offset(offset),
      db
        .select({ total: count(purchasedTickets.id) })
        .from(purchasedTickets)
        .where(whereClause),
    ]);

    const total = Number(totalResult[0]?.total ?? 0);

    // Fetch guest (door-sale) tickets for the same event
    const guestConditions = [eq(guestPurchasedTickets.eventId, eventId)];
    if (search) {
      guestConditions.push(
        or(
          ilike(guestPurchasedTickets.holderName, `%${search}%`),
          ilike(guestPurchasedTickets.holderEmail, `%${search}%`),
          ilike(guestPurchasedTickets.holderPhone, `%${search}%`)
        )
      );
    }
    console.log('[getOrganizerEventTickets] starting guest query');
    const guestRows = await db
      .select({
        id: guestPurchasedTickets.id,
        ticketCode: guestPurchasedTickets.ticketCode,
        purchasedAt: guestPurchasedTickets.createdAt,
        price: guestPurchasedTickets.price,
        holderName: guestPurchasedTickets.holderName,
        holderEmail: guestPurchasedTickets.holderEmail,
        holderPhone: guestPurchasedTickets.holderPhone,
        status: guestPurchasedTickets.status,
        isUsed: guestPurchasedTickets.isUsed,
        usedAt: guestPurchasedTickets.usedAt,
        qrCodeUrl: guestPurchasedTickets.qrCodeUrl,
        tierId: eventTickets.id,
        tierName: eventTickets.name,
        tierPrice: eventTickets.price,
        eventId: events.id,
        eventTitle: events.title,
        platformFeePercentage: events.platformFeePercentage,
        orderId: guestOrders.id,
        receiptUrl: guestOrders.receiptUrl,
        guestOrderStatus: guestOrders.status,
      })
      .from(guestPurchasedTickets)
      .leftJoin(eventTickets, eq(guestPurchasedTickets.ticketTierId, eventTickets.id))
      .leftJoin(events, eq(guestPurchasedTickets.eventId, events.id))
      .leftJoin(guestOrders, eq(guestPurchasedTickets.guestOrderId, guestOrders.id))
      .where(and(...guestConditions))
      .orderBy(desc(guestPurchasedTickets.createdAt));

    const formattedGuestTickets = guestRows.map(r => ({
      ...formatTicketRow({
        ...r,
        buyerUserId: null,
        buyerFirstName: null,
        buyerLastName: null,
        buyerEmail: r.holderEmail,
        buyerPhone: r.holderPhone,
      }),
      source: 'door_sale',
      orderId: r.orderId,
      receiptUrl: r.receiptUrl,
      guestOrderStatus: r.guestOrderStatus,
    }));

    const regularTickets = rows.map(r => ({ ...formatTicketRow(r), source: 'regular' }));

    return {
      tickets: [...regularTickets, ...formattedGuestTickets],
      pagination: {
        total: total + formattedGuestTickets.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get all sold tickets across all organizer events.
   * Supports optional ?eventId, ?search, pagination.
   */
  static async getOrganizerAllSales(organizerId, filters = {}, { isAdmin = false } = {}) {
    const { search, page = 1, limit = 20, eventId } = filters;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    const conditions = [ne(purchasedTickets.status, 'refunded')];
    if (organizerId) {
      conditions.push(eq(purchasedTickets.organizerId, organizerId));
    }

    if (eventId) {
      conditions.push(eq(purchasedTickets.eventId, eventId));
    }

    if (search) {
      conditions.push(
        or(
          ilike(purchasedTickets.holderName, `%${search}%`),
          ilike(purchasedTickets.holderEmail, `%${search}%`),
          ilike(purchasedTickets.holderPhone, `%${search}%`)
        )
      );
    }

    const whereClause = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id: purchasedTickets.id,
          ticketCode: purchasedTickets.ticketCode,
          purchasedAt: purchasedTickets.purchasedAt,
          price: purchasedTickets.price,
          holderName: purchasedTickets.holderName,
          holderEmail: purchasedTickets.holderEmail,
          holderPhone: purchasedTickets.holderPhone,
          status: purchasedTickets.status,
          isUsed: purchasedTickets.isUsed,
          usedAt: purchasedTickets.usedAt,
          qrCodeUrl: purchasedTickets.qrCodeUrl,
          tierId: eventTickets.id,
          tierName: eventTickets.name,
          tierPrice: eventTickets.price,
          eventId: events.id,
          eventTitle: events.title,
          platformFeePercentage: events.platformFeePercentage,
          buyerUserId: users.id,
          buyerFirstName: users.firstName,
          buyerLastName: users.lastName,
          buyerEmail: users.email,
          buyerPhone: users.phoneNumber,
        })
        .from(purchasedTickets)
        .leftJoin(eventTickets, eq(purchasedTickets.ticketTierId, eventTickets.id))
        .leftJoin(events, eq(purchasedTickets.eventId, events.id))
        .leftJoin(users, eq(purchasedTickets.userId, users.id))
        .where(whereClause)
        .orderBy(desc(purchasedTickets.purchasedAt))
        .limit(limitNum)
        .offset(offset),
      db
        .select({ total: count(purchasedTickets.id) })
        .from(purchasedTickets)
        .where(whereClause),
    ]);

    const total = Number(totalResult[0]?.total ?? 0);
    return {
      tickets: rows.map(r => formatTicketRow(r)),
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    };
  }

  /**
   * Organizer manually issues a ticket to a registered user.
   * Looks up the user by userId, email, or phone; then reuses purchaseTickets
   * (which handles QR generation, upload, and purchase email automatically).
   */
  static async issueTicketForUser(organizerId, body) {
    const { eventId, ticketTierId, identifier, quantity = 1, eventScheduleId } = body;

    // Verify event belongs to this organizer
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.organizerId, organizerId)),
      with: { venue: true },
    });
    if (!event) {
      throw new ApiError(404, 'Event not found or not owned by this organizer');
    }

    // Look up user: try UUID → email → phone
    let foundUser = null;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(identifier)) {
      foundUser = await getUserById(identifier);
    }
    if (!foundUser) {
      foundUser = await findByEmail(identifier);
    }
    if (!foundUser) {
      foundUser = await findByPhone(identifier);
    }
    if (!foundUser) {
      throw new ApiError(404, 'User not found. The user must be registered on GoKyro.');
    }

    const purchaseData = [
      {
        eventId,
        ticketTierId,
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
        eventScheduleId: eventScheduleId || null,
        holderName: `${foundUser.firstName} ${foundUser.lastName}`.trim(),
        holderEmail: foundUser.email || null,
        holderPhone: foundUser.phoneNumber || null,
      },
    ];

    return TicketService.purchaseTickets(foundUser.id, purchaseData);
  }

  /**
   * Refund purchased tickets and decrement the ticket tier sold count.
   * ticketRefunds: [{ id: <purchasedTicketId>, amount?: <number|string> }, ...]
   */
  static async refundPurchasedTickets(ticketRefunds = []) {
    if (!ticketRefunds || ticketRefunds.length === 0) return [];

    const ids = ticketRefunds.map(t => t.id).filter(Boolean);
    if (ids.length === 0) return [];

    const tickets = await db.query.purchasedTickets.findMany({
      where: inArray(purchasedTickets.id, ids),
    });

    const updated = [];
    for (const t of tickets) {
      const entry = ticketRefunds.find(r => r.id === t.id) || {};
      const amount = entry.amount || t.price || 0;

      await db
        .update(purchasedTickets)
        .set({
          refundedAt: new Date(),
          refundAmount: amount,
          status: 'refunded',
        })
        .where(eq(purchasedTickets.id, t.id));

      // Adjust ticket tier sold count (defensive)
      const tier = await db.query.eventTickets.findFirst({
        where: eq(eventTickets.id, t.ticketTierId),
      });
      if (tier) {
        const newSold = Math.max(0, (tier.quantitySold || 0) - 1);
        await db
          .update(eventTickets)
          .set({ quantitySold: newSold, updatedAt: new Date() })
          .where(eq(eventTickets.id, tier.id));
      }

      if (t.eventScheduleId) {
        try {
          await EventScheduleService.decrementTicketsSold(t.eventScheduleId, 1);
        } catch (err) {
          console.error('Failed to decrement schedule tickets sold:', err);
        }

        try {
          await db
            .update(eventTicketScheduleInventory)
            .set({
              quantitySold: sql`GREATEST(0, ${eventTicketScheduleInventory.quantitySold} - 1)`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(eventTicketScheduleInventory.ticketTierId, t.ticketTierId),
                eq(eventTicketScheduleInventory.scheduleId, t.eventScheduleId)
              )
            );
        } catch (err) {
          console.error('Failed to restore session inventory on refund:', err);
        }
      }

      const refreshed = await db.query.purchasedTickets.findFirst({
        where: eq(purchasedTickets.id, t.id),
      });
      if (refreshed) updated.push(refreshed);
    }

    return updated;
  }
}
