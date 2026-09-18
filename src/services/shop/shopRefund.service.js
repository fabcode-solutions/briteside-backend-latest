import Stripe from 'stripe';
import { db } from '../../db/index.js';
import { shopRefundRequests, shopOrders, shopProducts, users } from '../../db/schema/index.js';
import { eq, and, desc, sql, count, inArray } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import { UserSpendService } from '../userSpend.service.js';
import { createNotification } from '../notification.service.js';
import { ShopOrderService } from './shopOrder.service.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;

export const REFUND_REASONS = ['not_as_described', 'not_received', 'wrong_item', 'other'];

/**
 * Shop refund requests.
 *
 * The seller rules on their own shop's requests; an admin can overturn a
 * rejection. A shop with refunds switched off admits no requests at all, so
 * those orders have no in-app remedy — that is the accepted consequence of
 * making seller policy absolute.
 */
export class ShopRefundService {
  /** Paid orders the buyer could still dispute. */
  static async listEligibleOrders(buyerId) {
    const { orders } = await ShopOrderService.listPurchases(buyerId, 1, 100);
    const existing = await db.query.shopRefundRequests.findMany({
      where: eq(shopRefundRequests.buyerId, buyerId),
      columns: { orderId: true },
    });
    const disputed = new Set(existing.map(r => r.orderId));

    return orders.filter(order => order.refundEligible && !disputed.has(order.id));
  }

  static async requestRefund(buyerId, { orderId, reason, message }) {
    if (!REFUND_REASONS.includes(reason)) {
      throw new ApiError(400, `reason must be one of: ${REFUND_REASONS.join(', ')}`);
    }
    if (!message?.trim()) throw new ApiError(400, 'Tell the seller what went wrong');

    const order = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.buyerId !== buyerId) throw new ApiError(403, 'This is not your purchase');

    if (!order.refundsAllowedSnapshot) {
      throw new ApiError(403, 'This seller does not accept refunds on this purchase');
    }

    // Judged against the order's policy snapshot, never the seller's current
    // settings, so a later policy change can't revoke a paid-for right.
    const eligible = ShopOrderService.isRefundEligible({
      status: order.status,
      refundedAt: order.refundedAt,
      refundsAllowed: order.refundsAllowedSnapshot,
      refundWindowDays: order.refundWindowDaysSnapshot,
      refundAfterDownload: order.refundAfterDownloadSnapshot,
      firstDownloadedAt: order.firstDownloadedAt,
      paidAt: order.paidAt,
    });
    if (!eligible) throw new ApiError(403, 'This purchase is no longer eligible for a refund');

    const existing = await db.query.shopRefundRequests.findFirst({
      where: eq(shopRefundRequests.orderId, orderId),
    });
    if (existing) throw new ApiError(409, 'A refund request already exists for this purchase');

    const [request] = await db
      .insert(shopRefundRequests)
      .values({
        orderId,
        buyerId,
        sellerId: order.sellerId,
        reason,
        message: message.trim(),
        // Base price only — the order processing fee and platform fee are
        // non-refundable Briteside revenue, so that's the true eligible amount.
        amountCents: order.priceCents,
        stripePaymentIntentId: order.stripePaymentIntentId,
      })
      .returning();

    await createNotification({
      userId: order.sellerId,
      title: 'Refund requested',
      message: `A buyer requested a refund for "${order.productTitleSnapshot}".`,
      type: 'payment',
      relatedId: request.id,
      redirectTo: '/talent-dashboard?tab=shop',
      metadata: { requestId: request.id, orderId },
    }).catch(err => logger.error(`[ShopRefund] seller notify failed: ${err.message}`));

    return request;
  }

  /** Seller decides. Only from pending. */
  static async respondToRequest(sellerId, requestId, { action, resolutionNote }) {
    const request = await this.loadRequest(requestId);
    if (request.sellerId !== sellerId) throw new ApiError(403, 'This is not your shop');
    if (request.status !== 'pending') {
      throw new ApiError(409, `This request was already ${request.status}`);
    }

    return this.resolve(request, { action, resolutionNote, actorId: sellerId, role: 'seller' });
  }

  /**
   * Admin override — may act on a pending request or turn a rejection into an
   * approval. An approval is terminal, because the money has already moved.
   */
  static async adminOverride(adminId, requestId, { action, resolutionNote }) {
    const request = await this.loadRequest(requestId);
    if (request.status === 'approved') {
      throw new ApiError(409, 'This refund was already issued and cannot be changed');
    }

    return this.resolve(request, { action, resolutionNote, actorId: adminId, role: 'admin' });
  }

  static async loadRequest(requestId) {
    const request = await db.query.shopRefundRequests.findFirst({
      where: eq(shopRefundRequests.id, requestId),
    });
    if (!request) throw new ApiError(404, 'Refund request not found');
    return request;
  }

  static async resolve(request, { action, resolutionNote, actorId, role }) {
    if (!['approve', 'reject'].includes(action)) {
      throw new ApiError(400, "action must be 'approve' or 'reject'");
    }

    const now = new Date();
    const note = resolutionNote?.trim() || null;

    if (action === 'reject') {
      const [updated] = await db
        .update(shopRefundRequests)
        .set({
          status: 'rejected',
          resolvedByUserId: actorId,
          resolvedByRole: role,
          resolutionNote: note,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(shopRefundRequests.id, request.id))
        .returning();

      await this.notifyResolution(updated).catch(err =>
        logger.error(`[ShopRefund] reject notify failed: ${err.message}`)
      );
      return updated;
    }

    // ── Approve: issue the Stripe refund before touching our own records ────
    const order = await db.query.shopOrders.findFirst({
      where: eq(shopOrders.id, request.orderId),
    });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status === 'refunded') throw new ApiError(409, 'This order was already refunded');

    let stripeRefundId = null;

    // A free order has no charge to reverse; everything else still applies.
    if (order.chargedCents > 0) {
      if (!stripe) throw new ApiError(503, 'Payments are not configured');
      if (!order.stripePaymentIntentId) {
        throw new ApiError(400, 'This order has no payment to refund');
      }

      // Refund the base price only — the order processing fee and the 5%
      // platform fee are flat/percentage, non-refundable Briteside revenue
      // charges (see ShopOrderService.computeFees), same as ticket and
      // priority-message refunds.
      const refund = await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
        amount: order.priceCents,
        reason: 'requested_by_customer',
        // Claws the money back out of the seller's Connect balance while the
        // platform keeps its fee — the seller made the sale, so the seller
        // returns it. Same choice event ticket refunds make.
        reverse_transfer: true,
        refund_application_fee: false,
        metadata: { requestId: request.id, orderId: order.id },
      });
      stripeRefundId = refund.id;
    }

    const [updated] = await db
      .update(shopRefundRequests)
      .set({
        status: 'approved',
        resolvedByUserId: actorId,
        resolvedByRole: role,
        resolutionNote: note,
        refundAmountCents: order.priceCents,
        stripeRefundId,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(eq(shopRefundRequests.id, request.id))
      .returning();

    await db
      .update(shopOrders)
      .set({
        status: 'refunded',
        refundedAt: now,
        refundAmountCents: order.priceCents,
        stripeRefundId,
        updatedAt: now,
      })
      .where(eq(shopOrders.id, order.id));

    // Keep the product's sales figure honest — analytics reads it. GREATEST
    // guards against ever going negative.
    await db
      .update(shopProducts)
      .set({ salesCount: sql`GREATEST(${shopProducts.salesCount} - 1, 0)` })
      .where(eq(shopProducts.id, order.productId));

    await UserSpendService.markSpendRefunded({
      userId: order.buyerId,
      referenceId: order.id,
      referenceType: 'shop_order',
      spendType: 'shop',
      refundMeta: { source: 'shop_refund', requestId: request.id, stripeRefundId },
    });

    await this.notifyResolution(updated).catch(err =>
      logger.error(`[ShopRefund] approve notify failed: ${err.message}`)
    );

    return updated;
  }

  static async notifyResolution(request) {
    const order = await db.query.shopOrders.findFirst({
      where: eq(shopOrders.id, request.orderId),
      columns: { productTitleSnapshot: true },
    });
    const title = order?.productTitleSnapshot ?? 'your purchase';
    const approved = request.status === 'approved';

    await createNotification({
      userId: request.buyerId,
      title: approved ? 'Refund approved' : 'Refund declined',
      message: approved
        ? `Your refund for "${title}" was approved. It should reach your card in a few days.`
        : `Your refund request for "${title}" was declined.`,
      type: 'purchase_confirmation',
      relatedId: request.id,
      redirectTo: '/purchases',
      metadata: { requestId: request.id, orderId: request.orderId },
    });

    // Only worth telling the seller when the outcome wasn't theirs to make.
    if (request.resolvedByRole === 'admin') {
      await createNotification({
        userId: request.sellerId,
        title: approved ? 'Refund issued by admin' : 'Refund request closed by admin',
        message: approved
          ? `An admin refunded "${title}". The amount was debited from your balance.`
          : `An admin declined the refund request for "${title}".`,
        type: 'payment',
        relatedId: request.id,
        redirectTo: '/talent-dashboard?tab=shop',
        metadata: { requestId: request.id, orderId: request.orderId },
      });
    }
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  static baseSelect() {
    return {
      id: shopRefundRequests.id,
      orderId: shopRefundRequests.orderId,
      buyerId: shopRefundRequests.buyerId,
      sellerId: shopRefundRequests.sellerId,
      reason: shopRefundRequests.reason,
      message: shopRefundRequests.message,
      amountCents: shopRefundRequests.amountCents,
      status: shopRefundRequests.status,
      resolvedByRole: shopRefundRequests.resolvedByRole,
      resolutionNote: shopRefundRequests.resolutionNote,
      refundAmountCents: shopRefundRequests.refundAmountCents,
      resolvedAt: shopRefundRequests.resolvedAt,
      createdAt: shopRefundRequests.createdAt,
      productTitle: shopOrders.productTitleSnapshot,
      productId: shopOrders.productId,
      firstDownloadedAt: shopOrders.firstDownloadedAt,
      paidAt: shopOrders.paidAt,
    };
  }

  static async listForBuyer(buyerId) {
    return db
      .select(this.baseSelect())
      .from(shopRefundRequests)
      .innerJoin(shopOrders, eq(shopOrders.id, shopRefundRequests.orderId))
      .where(eq(shopRefundRequests.buyerId, buyerId))
      .orderBy(desc(shopRefundRequests.createdAt));
  }

  /** Requests against a seller's own shop, pending first. */
  static async listForSeller(sellerId, status = 'all') {
    const conditions = [eq(shopRefundRequests.sellerId, sellerId)];
    if (status !== 'all') conditions.push(eq(shopRefundRequests.status, status));

    const rows = await db
      .select({
        ...this.baseSelect(),
        buyerUsername: users.username,
        buyerFirstName: users.firstName,
        buyerLastName: users.lastName,
      })
      .from(shopRefundRequests)
      .innerJoin(shopOrders, eq(shopOrders.id, shopRefundRequests.orderId))
      .innerJoin(users, eq(users.id, shopRefundRequests.buyerId))
      .where(and(...conditions))
      .orderBy(desc(shopRefundRequests.createdAt));

    // Pending first, so the seller's action list sits at the top.
    return rows.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  }

  static async pendingCountForSeller(sellerId) {
    const [{ value }] = await db
      .select({ value: count() })
      .from(shopRefundRequests)
      .where(
        and(eq(shopRefundRequests.sellerId, sellerId), eq(shopRefundRequests.status, 'pending'))
      );
    return value;
  }

  static async adminList({ status = 'all', page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;
    const where = status === 'all' ? undefined : eq(shopRefundRequests.status, status);

    const [rows, [{ value: total }]] = await Promise.all([
      db
        .select({ ...this.baseSelect(), buyerUsername: users.username })
        .from(shopRefundRequests)
        .innerJoin(shopOrders, eq(shopOrders.id, shopRefundRequests.orderId))
        .innerJoin(users, eq(users.id, shopRefundRequests.buyerId))
        .where(where)
        .orderBy(desc(shopRefundRequests.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(shopRefundRequests).where(where),
    ]);

    // Seller names in one follow-up query — joining users twice in the query
    // above would need an alias for no real benefit.
    const sellerIds = [...new Set(rows.map(r => r.sellerId))];
    const sellers = sellerIds.length
      ? await db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(inArray(users.id, sellerIds))
      : [];
    const sellerById = new Map(sellers.map(s => [s.id, s.username]));

    return {
      requests: rows.map(r => ({ ...r, sellerUsername: sellerById.get(r.sellerId) ?? null })),
      hasMore: rows.length === limit,
      total,
    };
  }
}
