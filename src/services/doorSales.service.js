import crypto from 'crypto';
import Stripe from 'stripe';
import config from '../config/config.js';
import { db } from '../db/index.js';
import {
  events,
  eventTickets,
  guestOrders,
  guestOrderItems,
  guestPurchasedTickets,
  purchasedTickets,
} from '../db/schema/index.js';
import { eq, and, inArray, asc, sql, count } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { MediaModerationService, MEDIA_ENTITY } from './moderation/mediaModeration.service.js';
import { buildDoorSalesUrl } from '../utils/helper.js';
import { getRedirectUrls } from '../utils/redirect-urls.js';

let stripeClient = null;
if (config?.stripe?.secretKey) {
  stripeClient = new Stripe(config.stripe.secretKey);
} else {
  console.warn('Stripe not configured for door sales (STRIPE_SECRET_KEY missing)');
}

export class DoorSalesService {
  static createToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  static async enableDoorSales(eventId) {
    if (!eventId) throw new ApiError(400, 'eventId is required');

    const token = this.createToken();
    const updated = await db
      .update(events)
      .set({
        doorSalesEnabled: true,
        doorSalesToken: token,
        doorSalesTokenCreatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId))
      .returning();

    if (!updated || updated.length === 0) {
      throw new ApiError(404, 'Event not found');
    }

    return {
      token,
      doorSalesUrl: buildDoorSalesUrl(token),
    };
  }

  static async disableDoorSales(eventId) {
    if (!eventId) throw new ApiError(400, 'eventId is required');

    const updated = await db
      .update(events)
      .set({
        doorSalesEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId))
      .returning();

    if (!updated || updated.length === 0) {
      throw new ApiError(404, 'Event not found');
    }

    return { success: true };
  }

  static async regenerateDoorSalesToken(eventId) {
    if (!eventId) throw new ApiError(400, 'eventId is required');

    const token = this.createToken();
    const updated = await db
      .update(events)
      .set({
        doorSalesToken: token,
        doorSalesTokenCreatedAt: new Date(),
        doorSalesEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId))
      .returning();

    if (!updated || updated.length === 0) {
      throw new ApiError(404, 'Event not found');
    }

    return {
      token,
      doorSalesUrl: buildDoorSalesUrl(token),
    };
  }

  static async getDoorSalesConfig(eventId) {
    if (!eventId) throw new ApiError(400, 'eventId is required');

    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      with: {
        tickets: {
          where: eq(eventTickets.eventId, eventId),
          orderBy: asc(eventTickets.createdAt),
        },
      },
    });

    if (!event) throw new ApiError(404, 'Event not found');

    const tiers = (event.tickets || []).map(tier => ({
      id: tier.id,
      name: tier.name,
      description: tier.description,
      price: tier.price,
      doorSalePrice: tier.doorSalePrice,
      quantityAvailable: tier.quantityAvailable,
      minTicketsPerOrder: tier.minTicketsPerOrder,
      maxTicketsPerOrder: tier.maxTicketsPerOrder,
    }));

    return {
      event: {
        id: event.id,
        title: event.title,
        startDate: event.startDate,
        endDate: event.endDate,
        doorSalesEnabled: event.doorSalesEnabled,
        doorSalesToken: event.doorSalesToken,
      },
      tiers,
      doorSalesUrl: event.doorSalesToken ? buildDoorSalesUrl(event.doorSalesToken) : null,
    };
  }

  static async setTicketDoorSalePrices(eventId, ticketUpdates = []) {
    if (!eventId) throw new ApiError(400, 'eventId is required');
    if (!Array.isArray(ticketUpdates)) throw new ApiError(400, 'ticketUpdates must be an array');

    // Validate tiers belong to event and update in bulk.
    const tierIds = ticketUpdates.map(t => t.ticketTierId);
    if (tierIds.length === 0) return { updated: 0 };

    const tiers = await db.query.eventTickets.findMany({
      where: and(eq(eventTickets.eventId, eventId), inArray(eventTickets.id, tierIds)),
    });

    if (tiers.length !== tierIds.length) {
      throw new ApiError(400, 'One or more ticket tiers are invalid for this event');
    }

    for (const update of ticketUpdates) {
      await db
        .update(eventTickets)
        .set({
          doorSalePrice: update.doorSalePrice === null ? null : update.doorSalePrice,
          updatedAt: new Date(),
        })
        .where(eq(eventTickets.id, update.ticketTierId));
    }

    return { updated: ticketUpdates.length };
  }

  static ensureStripe() {
    if (!stripeClient) throw new ApiError(503, 'Payment provider is not configured');
    return stripeClient;
  }

  static async createGuestOrderAndCheckout(token, buyer, ticketSelections, platform) {
    if (!token || !buyer || !Array.isArray(ticketSelections) || ticketSelections.length === 0) {
      throw new ApiError(400, 'Invalid order creation payload');
    }

    const event = await db.query.events.findFirst({
      where: and(eq(events.doorSalesToken, token), eq(events.doorSalesEnabled, true)),
    });

    if (!event) {
      throw new ApiError(404, 'Door sale token is invalid or disabled');
    }

    // Same sales gate as regular checkout — paused while cover content removed
    if ((await MediaModerationService.statusOf(MEDIA_ENTITY.EVENT, event.id)) === 'rejected') {
      throw new ApiError(
        403,
        'Ticket sales for this event are paused due to a content violation.',
        true,
        '',
        { code: 'EVENT_CONTENT_PAUSED' }
      );
    }

    const ticketTierIds = ticketSelections.map(ts => ts.ticketTierId);
    const tiers = await db.query.eventTickets.findMany({
      where: and(eq(eventTickets.eventId, event.id), inArray(eventTickets.id, ticketTierIds)),
    });

    if (tiers.length !== ticketSelections.length) {
      throw new ApiError(400, 'One or more ticket selections are invalid');
    }

    // Validate door sale price and quantity
    let totalQuantity = 0;
    let totalAmount = 0;
    const lineItems = [];

    for (const sel of ticketSelections) {
      const tier = tiers.find(t => t.id === sel.ticketTierId);
      if (!tier?.doorSalePrice) {
        throw new ApiError(400, `Ticket tier ${sel.ticketTierId} is not available for door sale`);
      }
      const qty = Number(sel.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new ApiError(400, 'Invalid quantity');
      }
      if (tier.maxTicketsPerOrder && qty > tier.maxTicketsPerOrder) {
        throw new ApiError(400, `Quantity exceeds max per order for ${tier.name}`);
      }
      if (tier.minTicketsPerOrder && qty < tier.minTicketsPerOrder) {
        throw new ApiError(400, `Quantity below min per order for ${tier.name}`);
      }
      totalQuantity += qty;
      totalAmount += Number(tier.doorSalePrice) * qty;
      lineItems.push({ tier, qty });
    }

    const frontendBase = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://gokyro.com';
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM events WHERE id = ${event.id} FOR UPDATE`);

      // Capacity check
      if (event.capacity) {
        const soldPaid = await tx
          .select({ count: count() })
          .from(purchasedTickets)
          .where(eq(purchasedTickets.eventId, event.id));

        const soldGuest = await tx
          .select({ count: count() })
          .from(guestPurchasedTickets)
          .where(eq(guestPurchasedTickets.eventId, event.id));

        const existingCount = Number(soldPaid[0]?.count || 0) + Number(soldGuest[0]?.count || 0);
        if (existingCount + totalQuantity > Number(event.capacity)) {
          throw new ApiError(400, 'Not enough event capacity for selected tickets');
        }
      }

      const [guestOrder] = await tx
        .insert(guestOrders)
        .values({
          eventId: event.id,
          guestName: buyer.name,
          guestEmail: buyer.email,
          guestPhone: buyer.phone || null,
          totalAmount: totalAmount.toFixed(2),
          status: 'pending',
          isDoorSale: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      for (const li of lineItems) {
        await tx.insert(guestOrderItems).values({
          guestOrderId: guestOrder.id,
          ticketTierId: li.tier.id,
          quantity: li.qty,
          unitPrice: li.tier.doorSalePrice,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return guestOrder;
    });

    const stripe = this.ensureStripe();
    const checkoutLineItems = lineItems.map(li => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: li.tier.name,
          description: li.tier.description || 'Door sale ticket',
        },
        unit_amount: Math.round(Number(li.tier.doorSalePrice) * 100),
      },
      quantity: li.qty,
    }));

    const base = frontendBase.replace(/\/+$/, '');
    const { successUrl, cancelUrl } = getRedirectUrls(
      platform,
      base,
      `/door-sale/success?orderId=${result.id}`,
      `/door-sale/cancel?orderId=${result.id}`
    );

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: checkoutLineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: 'door_sale',
        feature: 'door_sale',
        guestOrderId: result.id,
        eventId: event.id,
        organizerId: event.organizerId ?? null,
      },
      customer_email: buyer.email,
    });

    await db
      .update(guestOrders)
      .set({
        paymentIntentId: session.payment_intent || null,
        stripeSessionId: session.id,
        updatedAt: new Date(),
      })
      .where(eq(guestOrders.id, result.id));

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      orderId: result.id,
    };
  }

  static async getEventByToken(token) {
    if (!token) throw new ApiError(400, 'token is required');

    const event = await db.query.events.findFirst({
      where: and(eq(events.doorSalesToken, token), eq(events.doorSalesEnabled, true)),
    });

    if (!event) throw new ApiError(404, 'Door sale token is invalid or disabled');

    const tickets = await db.query.eventTickets.findMany({
      where: eq(eventTickets.eventId, event.id),
    });

    return {
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        venueId: event.venueId,
      },
      tiers: (tickets || []).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        exterior: t.description,
        price: t.price,
        doorSalePrice: t.doorSalePrice,
        quantityAvailable: t.quantityAvailable,
        minTicketsPerOrder: t.minTicketsPerOrder,
        maxTicketsPerOrder: t.maxTicketsPerOrder,
      })),
    };
  }

  static async getTicketBundleByOrderId(orderId) {
    if (!orderId) throw new ApiError(400, 'orderId is required');

    const order = await db.query.guestOrders.findFirst({
      with: {
        event: true,
      },
      where: eq(guestOrders.id, orderId),
    });

    if (!order) throw new ApiError(404, 'Guest order not found');

    const items = await db.query.guestOrderItems.findMany({
      where: eq(guestOrderItems.guestOrderId, orderId),
    });

    const tickets = await db.query.guestPurchasedTickets.findMany({
      where: eq(guestPurchasedTickets.guestOrderId, orderId),
    });

    return { order, items, tickets, ticketsCount: tickets.length || 0 };
  }

  static async getTicketByCode(ticketCode) {
    if (!ticketCode) throw new ApiError(400, 'ticketCode is required');

    const ticket = await db.query.guestPurchasedTickets.findFirst({
      where: eq(guestPurchasedTickets.ticketCode, ticketCode),
    });

    if (!ticket) throw new ApiError(404, 'Ticket not found');

    return ticket;
  }

  static async getEventGuestOrders(eventId) {
    if (!eventId) throw new ApiError(400, 'eventId is required');

    const orders = await db.query.guestOrders.findMany({
      where: eq(guestOrders.eventId, eventId),
      with: { items: true },
    });

    return orders;
  }

  static async getEventGuestTickets(eventId) {
    if (!eventId) throw new ApiError(400, 'eventId is required');

    const tickets = await db.query.guestPurchasedTickets.findMany({
      where: eq(guestPurchasedTickets.eventId, eventId),
    });

    return tickets;
  }
}
