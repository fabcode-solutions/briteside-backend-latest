import Stripe from 'stripe';
import config from '../config/config.js';
import { db } from '../db/index.js';
import {
  orders,
  orderItems,
  events,
  refunds,
  purchasedTickets,
  purchasedMerchandise,
  eventTickets,
  eventMerchandise,
  users,
} from '../db/schema/index.js';
import { eq, and, inArray, count, lte } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import {
  isTicketUsed,
  isEventRefundable,
  isWithinRefundWindow,
  fetchStripeRefundMeta,
} from '../utils/refund-helpers.js';
import { OrderService } from './order.service.js';
import { TicketService } from './ticket.service.js';
import { EventService } from './event.service.js';
import { organizers } from '../db/schema/index.js';
import { createNotification } from './notification.service.js';
import { UserSpendService } from './userSpend.service.js';
import { EventTeamService } from './eventTeam.service.js';
import { PERMISSIONS } from '../config/event-team-permissions.js';
import { unsubscribeFromEvent } from '../utils/aws.util.js';

let stripe = null;
if (config.stripe?.secretKey) {
  stripe = new Stripe(config.stripe.secretKey);
}

const REFUND_VIEW_PERMISSION_KEYS = ['refunds.view', 'payouts.view_refunds'];

async function canTeamMemberViewRefunds(teamMember, eventId) {
  if (!teamMember?.id || !eventId) return false;

  if (teamMember.team?.eventId && teamMember.team.eventId !== eventId) {
    return false;
  }

  for (const permissionKey of REFUND_VIEW_PERMISSION_KEYS) {
    const allowed = await EventTeamService.hasPermission({
      teamMemberId: teamMember.id,
      eventId,
      permissionKey,
    });

    if (allowed) return true;
  }

  return false;
}

async function getOrganizerPendingCount(userId) {
  try {
    const org = await db.query.organizers.findFirst({ where: eq(organizers.userId, userId) });
    if (!org) return 0;
    const orgEvents = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.organizerId, org.id));
    const orgEventIds = orgEvents.map(e => e.id);
    if (orgEventIds.length === 0) return 0;
    const orgOrders = await db
      .select({ id: orders.id })
      .from(orders)
      .where(inArray(orders.eventId, orgEventIds));
    const orgOrderIds = orgOrders.map(o => o.id);
    if (orgOrderIds.length === 0) return 0;
    const [r] = await db
      .select({ total: count() })
      .from(refunds)
      .where(and(inArray(refunds.orderId, orgOrderIds), eq(refunds.status, 'requested')));
    return Number(r?.total ?? 0);
  } catch (err) {
    console.error('[RefundService] getOrganizerPendingCount failed:', err.message);
    return 0;
  }
}

export class RefundService {
  static ensureStripe() {
    if (!stripe) throw new ApiError(503, 'Payment provider not configured');
  }

  static async checkRefundEligibility(orderId, userId = null) {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!order) throw new ApiError(404, 'Order not found');
    if (userId && order.userId !== userId) throw new ApiError(403, 'Not authorized');

    if (order.status !== 'paid') {
      return {
        eligible: false,
        reason: 'Order is not paid',
        refundableTickets: [],
        nonRefundableTickets: [],
        refundableMerchandise: [],
        totalRefundAmount: 0,
      };
    }

    const event = await db.query.events.findFirst({
      where: eq(events.id, order.eventId),
    });
    if (!event) throw new ApiError(404, 'Event not found');

    if (!isEventRefundable(event)) {
      return {
        eligible: false,
        reason: 'Event does not allow refunds',
        refundableTickets: [],
        nonRefundableTickets: [],
        refundableMerchandise: [],
        totalRefundAmount: 0,
      };
    }

    if (!isWithinRefundWindow(event)) {
      return {
        eligible: false,
        reason: 'Refund window has passed',
        refundableTickets: [],
        nonRefundableTickets: [],
        refundableMerchandise: [],
        totalRefundAmount: 0,
      };
    }

    const items = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, orderId),
    });

    const allTicketIds = items
      .filter(i => i.itemType === 'ticket')
      .flatMap(i => i.purchasedItemIds || [])
      .filter(Boolean);

    const allTickets =
      allTicketIds.length > 0
        ? await db.query.purchasedTickets.findMany({
            where: inArray(purchasedTickets.id, allTicketIds),
          })
        : [];

    const existingRefunds = await db.query.refunds.findMany({
      where: and(
        eq(refunds.orderId, orderId),
        inArray(refunds.status, ['requested', 'pending', 'approved'])
      ),
    });

    // Build a set of ticket IDs that are already covered by a pending refund
    // refundedItems is stored as: [{ type: 'ticket', id: ticketId, amount }]
    const pendingTicketIds = new Set(
      existingRefunds
        .flatMap(r => r.refundedItems || [])
        .filter(i => i.type === 'ticket')
        .map(i => i.id)
    );

    const refundableTickets = [];
    const nonRefundableTickets = [];

    for (const ticket of allTickets) {
      const ticketData = {
        id: ticket.id,
        ticketNumber: ticket.ticketCode,
        price: parseFloat(ticket.price ?? '0'),
        scanCount: ticket.scanCount ?? 0,
        refundStatus: pendingTicketIds.has(ticket.id) ? 'requested' : null,
      };

      if (isTicketUsed(ticket)) {
        // Already scanned — cannot refund
        nonRefundableTickets.push(ticketData);
      } else {
        refundableTickets.push(ticketData);
      }
    }

    const merchItems = items.filter(i => i.itemType === 'merchandise');
    const allMerchIds = merchItems.flatMap(i => i.purchasedItemIds || []).filter(Boolean);

    const allMerch =
      allMerchIds.length > 0
        ? await db.query.purchasedMerchandise.findMany({
            where: inArray(purchasedMerchandise.id, allMerchIds),
          })
        : [];

    // Fetch merchandise details for name
    const merchandiseDetailIds = [...new Set(merchItems.map(i => i.itemId))];
    const merchandiseDetails =
      merchandiseDetailIds.length > 0
        ? await db.query.eventMerchandise.findMany({
            where: inArray(eventMerchandise.id, merchandiseDetailIds),
          })
        : [];
    const merchDetailMap = new Map(merchandiseDetails.map(m => [m.id, m]));

    // Map purchasedMerchandise back to order item for name lookup
    const orderItemByMerchId = new Map();
    for (const item of merchItems) {
      for (const pid of item.purchasedItemIds || []) {
        orderItemByMerchId.set(pid, item.itemId);
      }
    }

    const refundableMerchandise = allMerch
      .filter(m => m.status === 'active')
      .map(m => {
        const merchDetail = merchDetailMap.get(orderItemByMerchId.get(m.id));
        return {
          id: m.id,
          name: merchDetail?.name ?? 'Merchandise',
          quantity: m.quantity ?? 1,
          price: parseFloat(m.unitPrice ?? '0'),
        };
      });

    const selectableTickets = refundableTickets.filter(t => t.refundStatus !== 'requested');

    // Refund amount = base item prices only. The order processing fee and the 5%
    // platform fee are flat/percentage, non-refundable Briteside revenue charges
    // (see orders.platformShareCents), and Stripe's processing cost is a
    // Briteside-absorbed expense — none of these are deducted from, or owed by,
    // the customer here.
    let totalRefundAmount = 0;
    for (const t of selectableTickets) {
      totalRefundAmount += t.price;
    }
    for (const m of refundableMerchandise) {
      totalRefundAmount += m.price * m.quantity;
    }
    totalRefundAmount = parseFloat(totalRefundAmount.toFixed(2));

    // eligible = at least one ticket/merch can still be refunded
    const eligible = selectableTickets.length > 0 || refundableMerchandise.length > 0;

    return {
      eligible,
      reason: eligible ? null : 'All tickets already have pending refund requests',
      refundableTickets,
      nonRefundableTickets,
      refundableMerchandise,
      totalRefundAmount,
      // Keep legacy items array so requestRefund() still works unchanged
      items: items.map(item => ({
        orderItemId: item.id,
        itemType: item.itemType,
        refundableIds: (item.purchasedItemIds || []).filter(id =>
          item.itemType === 'ticket'
            ? allTickets.find(t => t.id === id && !isTicketUsed(t) && !pendingTicketIds.has(id))
            : allMerch.find(m => m.id === id && m.status === 'active')
        ),
        nonRefundableIds: (item.purchasedItemIds || []).filter(id =>
          item.itemType === 'ticket'
            ? allTickets.find(t => t.id === id && (isTicketUsed(t) || pendingTicketIds.has(id)))
            : allMerch.find(m => m.id === id && m.status !== 'active')
        ),
      })),
    };
  }

  static async initiateRefund(orderId, userId, { reason = 'requested_by_customer' } = {}) {
    const eligibility = await this.checkRefundEligibility(orderId, userId);
    if (!eligibility.eligible) {
      throw new ApiError(400, eligibility.reason || 'No refundable items');
    }

    // const order = await db.query.orders.findFirst({
    //   where: eq(orders.id, orderId),
    // });

    const order = await OrderService.getOrderById(orderId);
    if (!order) throw new ApiError(404, 'Order not found');

    // Refund amount = base item prices only. The order processing fee and the 5%
    // platform fee are flat/percentage, non-refundable Briteside revenue charges,
    // and Stripe's processing cost is a Briteside-absorbed expense — none of these
    // are deducted from the customer's refund.
    let refundAmount = 0;
    const refundedItems = [];
    for (const it of eligibility.items) {
      if (!it.refundableIds || it.refundableIds.length === 0) continue;
      if (it.itemType === 'ticket') {
        const tickets = await db.query.purchasedTickets.findMany({
          where: inArray(purchasedTickets.id, it.refundableIds),
        });
        for (const t of tickets) {
          const base = parseFloat(t.price || 0);
          refundAmount += base;
          refundedItems.push({ type: 'ticket', id: t.id, amount: base.toFixed(2) });
        }
      } else if (it.itemType === 'merchandise') {
        const merch = await db.query.purchasedMerchandise.findMany({
          where: inArray(purchasedMerchandise.id, it.refundableIds),
        });
        for (const m of merch) {
          const merchTotal = parseFloat(m.totalPrice || 0);
          refundAmount += merchTotal;
          refundedItems.push({ type: 'merch', id: m.id, amount: m.totalPrice });
        }
      }
    }
    refundAmount = parseFloat(refundAmount.toFixed(2));

    // Create Stripe refund — organizer bears cost, platform keeps fee + reserve
    const refundResponse = await stripe.refunds.create({
      payment_intent: order.paymentIntentId,
      amount: Math.round(refundAmount * 100),
      reason,
      reverse_transfer: true,
      refund_application_fee: false,
      metadata: { orderId: order.id },
    });

    const stripeMeta = await fetchStripeRefundMeta(
      stripe,
      order.paymentIntentId,
      refundResponse.id
    );

    const [refundRecord] = await db
      .insert(refunds)
      .values({
        orderId: order.id,
        amount: refundAmount.toFixed(2),
        reason,
        status: refundResponse.status || 'pending',
        stripeRefundId: refundResponse.id,
        refundType:
          Math.round(refundAmount * 100) === Math.round(parseFloat(order.totalAmount) * 100)
            ? 'full'
            : 'partial',
        refundedItems: refundedItems,
        stripeMeta,
        processedAt: refundResponse.status === 'succeeded' ? new Date() : null,
        createdAt: new Date(),
      })
      .returning();

    // Mark purchased items as refunded and restore inventory using helpers
    const ticketRefunds = refundedItems
      .filter(i => i.type === 'ticket')
      .map(i => ({ id: i.id, amount: i.amount }));
    const merchRefunds = refundedItems
      .filter(i => i.type === 'merch' || i.type === 'merchandise')
      .map(i => ({ id: i.id, amount: i.amount }));

    if (ticketRefunds.length > 0) await TicketService.refundPurchasedTickets(ticketRefunds);
    if (merchRefunds.length > 0) await EventService.refundPurchasedMerchandise(merchRefunds);

    // Update order status
    const [updatedOrder] = await db
      .update(orders)
      .set({ status: 'refunded', updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();

    // stripeFeeCents is Briteside's own absorbed cost, not money withheld from the
    // organizer, so it is not counted as "kept" from the organizer's transfer.
    const platformKeptCents = (order.platformShareCents || 0) + (order.reserveAmountCents || 0);

    await UserSpendService.markSpendRefunded({
      userId: order.userId,
      referenceId: order.id,
      referenceType: 'order',
      spendType: 'ticket_purchase',
      refundMeta: {
        source: 'ticket_refund_direct',
        refundRecordId: refundRecord.id,
        stripeRefundId: refundRecord.stripeRefundId,
        refundStatus: refundRecord.status,
        refundType: refundRecord.refundType,
        refundedAmountCents: Math.round(parseFloat(refundRecord.amount || '0') * 100),
        platformKeptCents,
      },
    });

    return { refund: refundRecord, order: updatedOrder };
  }

  // Issue full refunds for all paid orders on a cancelled event.
  // reverse_transfer: true  → organizer's Connect account bears the cost.
  // refund_application_fee: false → Briteside keeps all platform + card fees.
  static async issueEventCancellationRefunds(ordersToRefund, event) {
    const results = [];

    for (const order of ordersToRefund) {
      if (!order.paymentIntentId || ['refunded', 'cancelled'].includes(order.status)) {
        results.push({
          orderId: order.id,
          skipped: true,
          reason: 'no_payment_or_already_refunded',
        });
        continue;
      }

      try {
        const stripeRefund = await stripe.refunds.create({
          payment_intent: order.paymentIntentId,
          reason: 'requested_by_customer',
          reverse_transfer: true,
          refund_application_fee: false,
          metadata: {
            orderId: order.id,
            eventId: event.id,
            source: 'event_cancellation',
          },
        });

        const totalAmount = parseFloat(order.totalAmount || '0');

        const [refundRecord] = await db
          .insert(refunds)
          .values({
            orderId: order.id,
            amount: totalAmount.toFixed(2),
            reason: 'event_cancellation',
            status: stripeRefund.status || 'pending',
            stripeRefundId: stripeRefund.id,
            refundType: 'event_cancellation',
            refundedItems: null,
            processedAt: stripeRefund.status === 'succeeded' ? new Date() : null,
            createdAt: new Date(),
          })
          .returning();

        const orderItemRows = await db.query.orderItems.findMany({
          where: eq(orderItems.orderId, order.id),
        });
        const ticketItemIds = orderItemRows
          .filter(i => i.itemType === 'ticket')
          .flatMap(i => (Array.isArray(i.purchasedItemIds) ? i.purchasedItemIds : []))
          .filter(Boolean);

        if (ticketItemIds.length > 0) {
          await TicketService.refundPurchasedTickets(
            ticketItemIds.map(id => ({ id, amount: null }))
          );
        }

        await db
          .update(orders)
          .set({ status: 'refunded', updatedAt: new Date() })
          .where(eq(orders.id, order.id));

        const totalAmountCents = Math.round(totalAmount * 100);
        const platformKeptCents =
          (order.platformShareCents || 0) +
          (order.reserveAmountCents || 0) +
          (order.stripeFeeCents || 0);

        await UserSpendService.markSpendRefunded({
          userId: order.userId,
          referenceId: order.id,
          referenceType: 'order',
          spendType: 'ticket_purchase',
          refundMeta: {
            source: 'event_cancellation',
            refundRecordId: refundRecord.id,
            stripeRefundId: stripeRefund.id,
            refundStatus: stripeRefund.status,
            refundType: 'event_cancellation',
            // Full gross returned to user — platform fees not refunded
            refundedAmountCents: totalAmountCents,
            // Briteside keeps all platform + card-processing fees
            platformKeptCents,
            // Organizer's share reversed to cover the refund
            organizerBoreAmountCents: Math.max(0, totalAmountCents - platformKeptCents),
          },
        });

        results.push({ orderId: order.id, refundId: refundRecord.id, status: stripeRefund.status });
      } catch (err) {
        console.error(`Event cancellation refund failed for order ${order.id}:`, err.message);
        results.push({ orderId: order.id, error: err.message });
      }
    }

    return results;
  }

  // Create a refund *request* (no Stripe call) — customer requests a refund
  static async requestRefund(orderId, userId, { reason = 'requested_by_customer' } = {}) {
    // ensure the order is refundable for this user
    const eligibility = await this.checkRefundEligibility(orderId, userId);
    if (!eligibility.eligible) throw new ApiError(400, eligibility.reason || 'No refundable items');

    const order = await OrderService.getOrderById(orderId);
    if (!order) throw new ApiError(404, 'Order not found');

    // Check for existing refund request in 'requested' state for this order
    const existingRequest = await db.query.refunds.findFirst({
      where: and(eq(refunds.orderId, order.id), inArray(refunds.status, ['requested', 'rejected'])),
    });
    if (existingRequest) {
      if (existingRequest.status === 'rejected') {
        throw new ApiError(
          400,
          'Your refund request for this order has been rejected. Please contact admin for more information.'
        );
      }
      throw new ApiError(
        400,
        'A refund request for this order is already pending. Please contact admin for further assistance.'
      );
    }

    // Refund amount = base item prices only. The order processing fee and the 5%
    // platform fee are flat/percentage, non-refundable Briteside revenue charges,
    // and Stripe's processing cost is a Briteside-absorbed expense — none of these
    // are deducted from the customer's refund.
    let refundAmount = 0;
    const refundedItems = [];
    for (const it of eligibility.items) {
      if (!it.refundableIds || it.refundableIds.length === 0) continue;
      if (it.itemType === 'ticket') {
        const tickets = await db.query.purchasedTickets.findMany({
          where: inArray(purchasedTickets.id, it.refundableIds),
        });
        for (const t of tickets) {
          const base = parseFloat(t.price || 0);
          refundAmount += base;
          refundedItems.push({ type: 'ticket', id: t.id, amount: base.toFixed(2) });
        }
      } else if (it.itemType === 'merchandise') {
        const merch = await db.query.purchasedMerchandise.findMany({
          where: inArray(purchasedMerchandise.id, it.refundableIds),
        });
        for (const m of merch) {
          const merchTotal = parseFloat(m.totalPrice || 0);
          refundAmount += merchTotal;
          refundedItems.push({ type: 'merch', id: m.id, amount: m.totalPrice });
        }
      }
    }
    refundAmount = parseFloat(refundAmount.toFixed(2));

    // persist a refund request (status = 'requested')
    const [refundRecord] = await db
      .insert(refunds)
      .values({
        orderId: order.id,
        amount: refundAmount.toFixed(2),
        reason,
        status: 'requested',
        stripeRefundId: null,
        refundType:
          Math.round(refundAmount * 100) === Math.round(parseFloat(order.totalAmount) * 100)
            ? 'full'
            : 'partial',
        refundedItems,
        processedAt: null,
        createdAt: new Date(),
      })
      .returning();

    // Notify organizer — non-critical, fire-and-forget
    (async () => {
      try {
        const eventWithOrg = await db.query.events.findFirst({
          where: eq(events.id, order.eventId),
          with: { organizer: true },
        });
        if (eventWithOrg?.organizer?.userId) {
          await createNotification({
            userId: eventWithOrg.organizer.userId,
            type: 'purchase_confirmation',
            title: 'New Refund Request',
            message: `A refund request has been received for event **${eventWithOrg.title}**. Amount: ${refundRecord.amount}.`,
            redirectTo: `/organizer`,
            metadata: {
              eventId: order.eventId,
              eventTitle: eventWithOrg.title,
              refundAmount: refundRecord.amount,
              orderId: order.id,
              organizerLogoUrl: eventWithOrg.organizer.logoUrl ?? null,
            },
            relatedId: refundRecord.id,
            createdAt: new Date(),
          });
        }
      } catch (err) {
        console.error('[Notification] organizer refund request notify failed:', err.message);
      }
    })();

    return { refund: refundRecord, order };
  }

  /**
   * Update (approve/reject) a refund — organizer-only operation.
   * Parameters: refundId, eventId, actingUserId
   * Options: { status: 'approved'|'rejected', reason }
   */
  static async updateRefund(
    refundId,
    eventId,
    actingUserId,
    {
      status,
      reason = 'requested_by_customer',
      teamMember = null,
      bypassAuthorization = false,
    } = {}
  ) {
    if (!refundId) throw new ApiError(400, 'refundId is required');
    if (!eventId) throw new ApiError(400, 'eventId is required');
    if (!actingUserId) throw new ApiError(403, 'User must be authenticated');

    // find refund and its order
    const refundRecord = await db.query.refunds.findFirst({
      where: eq(refunds.id, refundId),
    });
    if (!refundRecord) throw new ApiError(404, 'Refund not found');

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, refundRecord.orderId),
    });
    if (!order) throw new ApiError(404, 'Associated order not found');

    if (order.eventId !== eventId) throw new ApiError(400, 'Event mismatch for refund');

    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) throw new ApiError(404, 'Event not found');

    // organizer = event.organizerId -> find organizers.userId
    const org = await db.query.organizers.findFirst({
      where: eq(organizers.id, event.organizerId),
    });

    const isOrganizer = org && org.userId === actingUserId;
    const hasTeamRefundPermission =
      teamMember &&
      (await EventTeamService.hasPermission({
        teamMemberId: teamMember.id,
        eventId,
        permissionKey: PERMISSIONS.ORDERS_REFUND,
      }));

    if (!bypassAuthorization && !isOrganizer && !hasTeamRefundPermission) {
      throw new ApiError(
        403,
        'Only event organizer or authorized team member may approve or reject refunds'
      );
    }

    // Only allow approve/reject
    const normalizedStatus = (status || '').toString().toLowerCase();
    if (!['approved', 'rejected'].includes(normalizedStatus)) {
      throw new ApiError(400, "status must be 'approved' or 'rejected'");
    }

    // If already final or Stripe call already in-flight, return idempotent result
    if (['approved', 'rejected', 'succeeded', 'pending'].includes(refundRecord.status)) {
      const currentOrder = await OrderService.getOrderById(order.id).catch(() => order);
      return { refund: refundRecord, order: currentOrder };
    }

    if (normalizedStatus === 'rejected') {
      const actorRole = bypassAuthorization ? 'rejected_by_admin' : 'rejected_by_organizer';
      const rejReason = reason
        ? ` | ${actorRole}:${actingUserId} reason:${reason}`
        : ` | ${actorRole}:${actingUserId}`;
      const [updatedRefund] = await db
        .update(refunds)
        .set({
          status: 'rejected',
          reason: `${refundRecord.reason || ''}${rejReason}`,
          processedAt: new Date(),
        })
        .where(eq(refunds.id, refundRecord.id))
        .returning();

      // Notify user about rejection
      await createNotification({
        userId: order.userId,
        type: 'purchase_confirmation',
        title: 'Refund Request Rejected',
        message: `Your refund request for event **${event.title}** has been rejected. Amount: ${refundRecord.amount}.`,
        redirectTo: '/profile/refunds',
        metadata: {
          eventId: event.id,
          eventTitle: event.title,
          refundAmount: refundRecord.amount,
          orderId: order.id,
          organizerLogoUrl: org?.logoUrl ?? null,
        },
        relatedId: refundRecord.id,
        createdAt: new Date(),
      });

      return { refund: updatedRefund, order };
    }

    // APPROVE: create Stripe refund if not present and apply refunds to items
    this.ensureStripe();

    // If a stripeRefundId exists, reuse it; otherwise create a new Stripe refund
    let stripeRefundId = refundRecord.stripeRefundId;
    let refundResponse = null;
    let orderDetails = null;

    if (!stripeRefundId) {
      // create stripe refund for refundRecord.amount
      orderDetails = await OrderService.getOrderById(order.id);
      if (!orderDetails || !orderDetails.paymentIntentId)
        throw new ApiError(400, 'Order payment intent not available for refund');

      try {
        refundResponse = await stripe.refunds.create({
          payment_intent: orderDetails.paymentIntentId,
          amount: Math.round(parseFloat(refundRecord.amount || '0') * 100),
          reason:
            reason ||
            refundRecord.reason ||
            (bypassAuthorization ? 'approved_by_admin' : 'approved_by_organizer'),
          reverse_transfer: true,
          refund_application_fee: false,
          metadata: {
            orderId: order.id,
            refundId,
            actor: bypassAuthorization ? 'admin' : 'organizer',
          },
        });
      } catch (stripeErr) {
        // Charge was already fully refunded on Stripe's side (e.g. a previous call that
        // succeeded but whose DB write was lost). Recover by reusing the existing refund.
        if (stripeErr.code === 'charge_already_refunded') {
          const pi = await stripe.paymentIntents.retrieve(orderDetails.paymentIntentId, {
            expand: ['latest_charge.refunds'],
          });
          const existing = pi.latest_charge?.refunds?.data?.[0];
          if (!existing) throw stripeErr;
          refundResponse = existing;
        } else {
          throw stripeErr;
        }
      }
      stripeRefundId = refundResponse.id;
    }

    // update refund record with stripe id/status and fee breakdown
    const newStatus = refundResponse?.status || 'pending';
    const stripeMeta = refundResponse
      ? await fetchStripeRefundMeta(
          stripe,
          orderDetails?.paymentIntentId ?? order.paymentIntentId,
          stripeRefundId
        )
      : null;

    const [savedRefund] = await db
      .update(refunds)
      .set({
        status: newStatus,
        stripeRefundId,
        ...(stripeMeta ? { stripeMeta } : {}),
        processedAt: newStatus === 'succeeded' ? new Date() : null,
      })
      .where(eq(refunds.id, refundRecord.id))
      .returning();

    // mark items as refunded and fix inventory/quantity
    const items = refundRecord.refundedItems || [];

    // mark items as refunded and fix inventory/quantity using service helpers
    const ticketRefunds2 = items
      .filter(i => i.type === 'ticket')
      .map(i => ({ id: i.id, amount: i.amount }));
    const merchRefunds2 = items
      .filter(i => i.type === 'merch' || i.type === 'merchandise')
      .map(i => ({ id: i.id, amount: i.amount }));

    if (ticketRefunds2.length > 0) await TicketService.refundPurchasedTickets(ticketRefunds2);
    if (merchRefunds2.length > 0) await EventService.refundPurchasedMerchandise(merchRefunds2);

    // Optionally update order status to refunded (force true to bypass transition checks)
    const { updatedOrder } = await OrderService.updateOrder(
      order.id,
      null,
      { status: 'refunded' },
      { force: true }
    );

    // Spend updates first — notification must not block these
    UserSpendService.recordSpend({
      userId: order.userId,
      spendType: 'ticket_purchase',
      amountCents: -Math.round(parseFloat(savedRefund.amount || '0') * 100),
      referenceId: savedRefund.id,
      referenceType: 'refund',
      eventId: order.eventId,
      metadata: {
        refundType: refundRecord.refundType ?? 'partial',
        originalSpendType: 'ticket_purchase',
        reason: reason || refundRecord.reason || 'requested_by_customer',
        orderId: order.id,
      },
      stripePaymentIntentId: stripeRefundId,
      paidAt: savedRefund.processedAt ?? new Date(),
    }).catch(err => console.error('[UserSpend] refund negative entry failed:', err.message));

    await UserSpendService.markSpendRefunded({
      userId: order.userId,
      referenceId: order.id,
      referenceType: 'order',
      spendType: 'ticket_purchase',
      refundMeta: {
        source: 'ticket_refund_approved',
        refundRecordId: savedRefund.id,
        stripeRefundId,
        refundStatus: savedRefund.status,
        refundType: savedRefund.refundType,
        refundedAmountCents: Math.round(parseFloat(savedRefund.amount || '0') * 100),
      },
    });

    // Notify user — non-critical, must not throw and break the refund flow
    createNotification({
      userId: order.userId,
      type: 'purchase_confirmation',
      title: 'Refund Request Approved',
      message: `Your refund request for event **${event.title}** has been approved. Amount refunded: ${savedRefund.amount}.`,
      redirectTo: '/profile/refunds',
      metadata: {
        eventId: event.id,
        eventTitle: event.title,
        refundAmount: savedRefund.amount,
        orderId: order.id,
        organizerLogoUrl: org?.logoUrl ?? null,
      },
      relatedId: savedRefund.id,
      createdAt: new Date(),
    }).catch(err => console.error('[Notification] refund approval notify failed:', err.message));

    return { refund: savedRefund, order: updatedOrder };
  }
  static async adminUpdateRefund(refundId, adminUserId, { status, reason } = {}) {
    if (!refundId) throw new ApiError(400, 'refundId is required');
    if (!adminUserId) throw new ApiError(403, 'Admin must be authenticated');

    const refundRecord = await db.query.refunds.findFirst({
      where: eq(refunds.id, refundId),
    });
    if (!refundRecord) throw new ApiError(404, 'Refund not found');

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, refundRecord.orderId),
    });
    if (!order) throw new ApiError(404, 'Associated order not found');

    return this.updateRefund(refundId, order.eventId, adminUserId, {
      status,
      reason,
      bypassAuthorization: true,
    });
  }
  static async deleteRefundRequest(refundId, adminUserId) {
    if (!refundId) throw new ApiError(400, 'refundId is required');
    if (!adminUserId) throw new ApiError(403, 'Admin must be authenticated');

    const refundRecord = await db.query.refunds.findFirst({
      where: eq(refunds.id, refundId),
    });
    if (!refundRecord) throw new ApiError(404, 'Refund not found');

    if (refundRecord.stripeRefundId) {
      throw new ApiError(
        400,
        'This refund has already been processed by Stripe and cannot be deleted — reject it instead if it needs to be reversed'
      );
    }

    const [deleted] = await db.delete(refunds).where(eq(refunds.id, refundId)).returning();
    return deleted;
  }

  static async listAllRefundsAdmin({ page = 1, limit = 20, status, overdue } = {}) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const conditions = [];
    if (status) conditions.push(eq(refunds.status, status));
    if (overdue === 'true' || overdue === true) {
      conditions.push(eq(refunds.status, 'requested'));
      conditions.push(lte(refunds.createdAt, sevenDaysAgo));
    }

    const whereConditions = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, refundsList] = await Promise.all([
      db.select({ total: count() }).from(refunds).where(whereConditions),
      db.query.refunds.findMany({
        where: whereConditions,
        limit: limitNum,
        offset,
        orderBy: (r, { desc }) => [desc(r.createdAt)],
      }),
    ]);

    const totalCount = countResult[0]?.total ?? 0;

    if (refundsList.length === 0) {
      return {
        items: [],
        pagination: { page: pageNum, limit: limitNum, total: 0, pages: 0 },
      };
    }

    const orderIds = refundsList.map(r => r.orderId);
    const relevantOrders = await db.query.orders.findMany({
      where: inArray(orders.id, orderIds),
    });

    const eventIds = [...new Set(relevantOrders.map(o => o.eventId))];
    const eventsList =
      eventIds.length > 0
        ? await db.query.events.findMany({ where: inArray(events.id, eventIds) })
        : [];
    const eventMap = new Map(eventsList.map(e => [e.id, e]));

    const organizerIds = [...new Set(eventsList.map(e => e.organizerId).filter(Boolean))];
    const organizersList =
      organizerIds.length > 0
        ? await db.query.organizers.findMany({ where: inArray(organizers.id, organizerIds) })
        : [];
    const organizerMap = new Map(organizersList.map(o => [o.id, o]));

    // Buyer info — orders only store userId, so join the users table for display
    const buyerIds = [...new Set(relevantOrders.map(o => o.userId).filter(Boolean))];
    const buyersList =
      buyerIds.length > 0
        ? await db.query.users.findMany({ where: inArray(users.id, buyerIds) })
        : [];
    const buyerMap = new Map(buyersList.map(u => [u.id, u]));

    const orderMap = new Map(
      relevantOrders.map(o => {
        const buyer = buyerMap.get(o.userId) || null;
        return [
          o.id,
          {
            ...o,
            buyerName: buyer?.fullName ?? buyer?.name ?? null,
            buyerUsername: buyer?.username ?? null,
          },
        ];
      })
    );

    const enriched = refundsList.map(refund => {
      const order = orderMap.get(refund.orderId) || null;
      const event = order ? eventMap.get(order.eventId) || null : null;
      const organizer = event ? organizerMap.get(event.organizerId) || null : null;
      const daysOld = Math.floor(
        (Date.now() - new Date(refund.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      const isOverdue = refund.status === 'requested' && daysOld >= 7;
      return { ...refund, order, event, organizer, daysOld, isOverdue };
    });

    return {
      items: enriched,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum),
      },
    };
  }

  static async processRefundWebhook(stripeRefundId, refundData) {
    // Find refund record by Stripe refund ID
    const refundRecord = await db.query.refunds.findFirst({
      where: eq(refunds.stripeRefundId, stripeRefundId),
    });

    if (!refundRecord) {
      console.warn('Refund record not found for Stripe refund:', stripeRefundId);
      return null;
    }

    // Update refund status based on webhook data
    const newStatus = refundData.status || 'succeeded';
    const [updatedRefund] = await db
      .update(refunds)
      .set({
        status: newStatus,
        processedAt: newStatus === 'succeeded' ? new Date() : refundRecord.processedAt,
      })
      .where(eq(refunds.id, refundRecord.id))
      .returning();

    // Get associated order and event
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, refundRecord.orderId),
    });

    const event = order
      ? await db.query.events.findFirst({
          where: eq(events.id, order.eventId),
        })
      : null;

    if (order && newStatus === 'succeeded') {
      await UserSpendService.markSpendRefunded({
        userId: order.userId,
        referenceId: order.id,
        referenceType: 'order',
        spendType: 'ticket_purchase',
        refundMeta: {
          source: 'ticket_refund_webhook',
          refundRecordId: updatedRefund.id,
          stripeRefundId,
          refundStatus: newStatus,
          refundedAmountCents: Math.round(parseFloat(updatedRefund.amount || '0') * 100),
        },
      });

      const ticketIds = (refundRecord.refundedItems || [])
        .filter(i => i.type === 'ticket')
        .map(i => i.id);
      if (ticketIds.length > 0) {
        try {
          const tickets = await db
            .select({
              id: purchasedTickets.id,
              snsSubscriptionArn: purchasedTickets.snsSubscriptionArn,
            })
            .from(purchasedTickets)
            .where(inArray(purchasedTickets.id, ticketIds));
          await Promise.allSettled(
            tickets
              .filter(t => t.snsSubscriptionArn)
              .map(t => unsubscribeFromEvent(t.snsSubscriptionArn))
          );
          await db
            .update(purchasedTickets)
            .set({ snsSubscriptionArn: null })
            .where(inArray(purchasedTickets.id, ticketIds));
        } catch (snsError) {
          console.error('Failed to unsubscribe refunded tickets from SNS topic:', snsError);
        }
      }
    }

    return { refund: updatedRefund, order, event };
  }

  static async getRefundById(refundId, userId = null, { teamMember = null } = {}) {
    const refundRecord = await db.query.refunds.findFirst({
      where: eq(refunds.id, refundId),
    });

    if (!refundRecord) throw new ApiError(404, 'Refund not found');

    // Get associated order
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, refundRecord.orderId),
    });

    if (!order) throw new ApiError(404, 'Associated order not found');

    if (teamMember) {
      const event = await db.query.events.findFirst({
        where: eq(events.id, order.eventId),
      });

      if (!event || !teamMember.team || teamMember.team.eventId !== event.id) {
        throw new ApiError(403, 'Not authorized to view this refund');
      }

      const allowed = await canTeamMemberViewRefunds(teamMember, event.id);
      if (!allowed) {
        throw new ApiError(403, 'Not authorized to view this refund');
      }

      return { refund: refundRecord, order, event };
    }

    // Check ownership if userId provided; organizers can also view their event refunds
    let event = await db.query.events.findFirst({
      where: eq(events.id, order.eventId),
      with: {
        organizer: true,
      },
    });

    if (userId && order.userId !== userId) {
      if (!event || event.organizer?.userId !== userId) {
        throw new ApiError(403, 'Not authorized to view this refund');
      }
    }

    return { refund: refundRecord, order, event };
  }

  // NOTE: updateRefund(refundId,eventId,actingUserId,{status, reason}) implemented above

  static async listUserRefunds(
    userId,
    eventId,
    isOrganizer = false,
    { page = 1, limit = 20, status } = {},
    { teamMember = null } = {}
  ) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    let ordersFilter = null;

    if (teamMember) {
      const teamEventId = teamMember.team?.eventId;
      const effectiveEventId = eventId || teamEventId;

      if (!teamEventId || !effectiveEventId || effectiveEventId !== teamEventId) {
        throw new ApiError(403, 'Not authorized to list refunds for this event');
      }

      const allowed = await canTeamMemberViewRefunds(teamMember, effectiveEventId);
      if (!allowed) {
        throw new ApiError(403, 'Not authorized to list refunds for this event');
      }

      ordersFilter = eq(orders.eventId, effectiveEventId);
    } else if (isOrganizer && eventId) {
      // Organizer view, specific event: verify ownership then filter by event
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        with: {
          organizer: true,
        },
      });

      if (!event || event.organizer?.userId !== userId) {
        throw new ApiError(403, 'Not authorized to list refunds for this event');
      }

      ordersFilter = eq(orders.eventId, eventId);
    } else if (isOrganizer && !eventId) {
      // No event filter — fetch all orders across all organizer's events
      const org = await db.query.organizers.findFirst({ where: eq(organizers.userId, userId) });
      if (!org) {
        return {
          items: [],
          pagination: { page: pageNum, limit: limitNum, total: 0, pages: 0 },
          pendingCount: 0,
        };
      }
      const orgEvents = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.organizerId, org.id));
      const orgEventIds = orgEvents.map(e => e.id);
      if (orgEventIds.length === 0) {
        return {
          items: [],
          pagination: { page: pageNum, limit: limitNum, total: 0, pages: 0 },
          pendingCount: 0,
        };
      }
      ordersFilter = inArray(orders.eventId, orgEventIds);
    } else if (eventId && userId) {
      ordersFilter = and(eq(orders.userId, userId), eq(orders.eventId, eventId));
    } else if (userId) {
      // User view, no event: filter by userId
      ordersFilter = eq(orders.userId, userId);
    } else {
      throw new ApiError(403, 'Authentication required to list refunds');
    }

    const relevantOrders = await db.query.orders.findMany({
      where: ordersFilter,
    });

    const orderIds = relevantOrders.map(o => o.id);
    if (orderIds.length === 0) {
      const earlyPending = isOrganizer
        ? await getOrganizerPendingCount(userId)
        : teamMember
          ? 0
          : null;
      return {
        items: [],
        pagination: { page: pageNum, limit: limitNum, total: 0, pages: 0 },
        ...(earlyPending !== null ? { pendingCount: earlyPending } : {}),
      };
    }

    const whereConditions = [inArray(refunds.orderId, orderIds)];
    if (status) {
      whereConditions.push(eq(refunds.status, status));
    }

    const [countResult, refundsList] = await Promise.all([
      db
        .select({ total: count() })
        .from(refunds)
        .where(and(...whereConditions)),
      db.query.refunds.findMany({
        where: and(...whereConditions),
        limit: limitNum,
        offset,
      }),
    ]);

    const totalCount = countResult[0]?.total ?? 0;

    let pendingCount = null;
    if (isOrganizer) {
      pendingCount = await getOrganizerPendingCount(userId);
    } else if (teamMember) {
      const [r] = await db
        .select({ total: count() })
        .from(refunds)
        .where(and(inArray(refunds.orderId, orderIds), eq(refunds.status, 'requested')));
      pendingCount = Number(r?.total ?? 0);
    }

    const orderMap = new Map(relevantOrders.map(order => [order.id, order]));
    const eventIds = Array.from(new Set(relevantOrders.map(o => o.eventId)));
    const eventsList = await db.query.events.findMany({
      where: inArray(events.id, eventIds),
    });
    const eventMap = new Map(eventsList.map(evt => [evt.id, evt]));

    const enrichedRefunds = refundsList.map(refund => {
      const order = orderMap.get(refund.orderId) || null;
      const event = order ? eventMap.get(order.eventId) || null : null;
      return { ...refund, order, event };
    });

    const totalPages = Math.ceil(totalCount / limitNum);

    return {
      items: enrichedRefunds,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: totalPages,
      },
      ...(pendingCount !== null ? { pendingCount } : {}),
    };
  }
}
