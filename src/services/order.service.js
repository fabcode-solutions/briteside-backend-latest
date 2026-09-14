import { db } from '../db/index.js';
import {
  orders,
  orderItems,
  eventTickets,
  eventMerchandise,
  events,
  users,
} from '../db/schema/index.js';
import { eq, and, desc, asc, gte, lte, lt, count, sql } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import {
  purchasedTickets,
  purchasedMerchandise,
  eventTicketScheduleInventory,
} from '../db/schema/index.js';
import { generateTicketCode } from '../utils/code-generator.js';
import QRCode from 'qrcode';
import { UploadService } from './upload.service.js';
import { MediaModerationService, MEDIA_ENTITY } from './moderation/mediaModeration.service.js';
import { subscribeWithRetry } from '../utils/aws.util.js';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const SORTABLE_ORDER_FIELDS = ['createdAt', 'totalAmount', 'status'];

function getEffectiveTicketPrice(tier) {
  const base = parseFloat(tier.price);
  if (!tier.isSaleActive || !tier.saleDiscountPercent || !tier.saleStartDate || !tier.saleEndDate)
    return base;
  const now = new Date();
  if (now < new Date(tier.saleStartDate) || now > new Date(tier.saleEndDate)) return base;
  return parseFloat((base * (1 - parseFloat(tier.saleDiscountPercent) / 100)).toFixed(2));
}

const parseNumber = value => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseInteger = value => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
};

const addDateFilters = (whereConditions, year, month) => {
  const yearNum = parseInteger(year);
  const monthNum = parseInteger(month);

  if (yearNum === null && monthNum !== null) {
    throw new ApiError(400, 'Year is required when month is provided');
  }

  if (yearNum !== null) {
    if (monthNum !== null) {
      if (monthNum < 1 || monthNum > 12) {
        throw new ApiError(400, 'Month must be between 1 and 12');
      }
      const startDate = new Date(yearNum, monthNum - 1, 1);
      const endDate = new Date(yearNum, monthNum, 1);
      whereConditions.push(gte(orders.createdAt, startDate));
      whereConditions.push(lt(orders.createdAt, endDate));
      return;
    }

    const startDate = new Date(yearNum, 0, 1);
    const endDate = new Date(yearNum + 1, 0, 1);
    whereConditions.push(gte(orders.createdAt, startDate));
    whereConditions.push(lt(orders.createdAt, endDate));
  }
};

const normalizePagination = (page, limit) => {
  const rawPage = parseInteger(page);
  const rawLimit = parseInteger(limit);
  const pageNum = Math.max(1, rawPage || 1);
  const limitNum = Math.min(MAX_PAGE_LIMIT, Math.max(1, rawLimit || DEFAULT_PAGE_LIMIT));
  const offset = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, offset };
};

const buildWhereClause = whereConditions => {
  if (!whereConditions?.length) return undefined;
  return whereConditions.length === 1 ? whereConditions[0] : and(...whereConditions);
};

const normalizeSorting = (sortBy, sortOrder) => {
  const sortField = SORTABLE_ORDER_FIELDS.includes(sortBy) ? sortBy : 'createdAt';
  const sortFn = sortOrder === 'asc' ? asc : desc;
  return { sortField, sortFn };
};

export class OrderService {
  static async enrichOrders(ordersList = [], { includeEvent = false, includeUser = false } = {}) {
    return Promise.all(
      ordersList.map(async order => {
        const [items, event, user] = await Promise.all([
          db.query.orderItems.findMany({
            where: eq(orderItems.orderId, order.id),
          }),
          includeEvent
            ? db.query.events.findFirst({
                where: eq(events.id, order.eventId),
              })
            : Promise.resolve(null),
          includeUser
            ? db.query.users.findFirst({
                where: eq(users.id, order.userId),
                columns: {
                  id: true,
                  username: true,
                  email: true,
                  name: true,
                  firstName: true,
                  lastName: true,
                  image: true,
                },
              })
            : Promise.resolve(null),
        ]);

        return {
          ...order,
          orderItems: items,
          ...(includeEvent ? { event } : {}),
          ...(includeUser ? { user } : {}),
        };
      })
    );
  }

  /**
   * Create a new order with order items
   */
  static async createOrder(
    userId,
    eventId,
    ticketSelections = [],
    merchandiseSelections = [],
    holderInfo = {}
  ) {
    try {
      // Basic validation
      if (!userId) throw new ApiError(400, 'User ID is required');
      if (!eventId) throw new ApiError(400, 'Event ID is required');

      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
      });
      if (!event) throw new ApiError(404, 'Event not found');
      if (event.isFree) throw new ApiError(400, 'Event is free. Use join flow instead');

      // Sales paused while the event has removed cover content (self-heals
      // when the organizer replaces the image or a moderator restores it)
      if ((await MediaModerationService.statusOf(MEDIA_ENTITY.EVENT, eventId)) === 'rejected') {
        throw new ApiError(
          403,
          'Ticket sales for this event are paused due to a content violation.',
          true,
          '',
          { code: 'EVENT_CONTENT_PAUSED' }
        );
      }

      let totalAmount = 0;
      const items = [];

      for (const sel of ticketSelections) {
        const tier = await db.query.eventTickets.findFirst({
          where: and(eq(eventTickets.id, sel.ticketTierId), eq(eventTickets.eventId, eventId)),
        });
        if (!tier) throw new ApiError(404, `Ticket tier not found: ${sel.ticketTierId}`);

        const groupDealSize = tier.groupDealSize ? parseInt(tier.groupDealSize, 10) : null;
        if (groupDealSize && sel.quantity % groupDealSize !== 0) {
          throw new ApiError(
            400,
            `"${tier.name}" is a group deal: quantity must be a multiple of ${groupDealSize}. Got ${sel.quantity}.`
          );
        }

        const tierPrice = getEffectiveTicketPrice(tier);
        const effectivePerTicketPrice = groupDealSize ? tierPrice / groupDealSize : tierPrice;
        totalAmount += effectivePerTicketPrice * sel.quantity;
        items.push({
          itemType: 'ticket',
          itemId: sel.ticketTierId,
          quantity: sel.quantity,
          price: effectivePerTicketPrice.toFixed(4),
        });
      }

      for (const sel of merchandiseSelections) {
        const merch = await db.query.eventMerchandise.findFirst({
          where: and(
            eq(eventMerchandise.id, sel.merchandiseId),
            eq(eventMerchandise.eventId, eventId)
          ),
        });
        if (!merch) throw new ApiError(404, `Merchandise not found: ${sel.merchandiseId}`);
        const price = parseFloat(merch.price);
        totalAmount += price * sel.quantity;
        items.push({
          itemType: 'merchandise',
          itemId: sel.merchandiseId,
          quantity: sel.quantity,
          price: price.toFixed(2),
        });
      }

      const [order] = await db
        .insert(orders)
        .values({
          userId,
          eventId,
          totalAmount: totalAmount.toFixed(2),
          status: 'pending',
          billingAddress: holderInfo.billingAddress || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (items.length > 0) {
        const orderItemsData = items.map(i => ({
          orderId: order.id,
          itemType: i.itemType,
          itemId: i.itemId,
          quantity: i.quantity,
          price: i.price,
          createdAt: new Date(),
        }));
        await db.insert(orderItems).values(orderItemsData);
      }

      // Fetch created order with its items
      const orderWithItems = await db.query.orders.findFirst({
        where: eq(orders.id, order.id),
      });
      const orderItemsList = await db.query.orderItems.findMany({
        where: eq(orderItems.orderId, order.id),
      });

      return {
        ...orderWithItems,
        orderItems: orderItemsList,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Failed to create order:', error);
      throw new ApiError(500, 'Failed to create order');
    }
  }

  static async getOrderById(orderId, userId = null) {
    try {
      const whereCondition = userId
        ? and(eq(orders.id, orderId), eq(orders.userId, userId))
        : eq(orders.id, orderId);
      const order = await db.query.orders.findFirst({ where: whereCondition });
      if (!order) throw new ApiError(404, 'Order not found');
      const orderItemsList = await db.query.orderItems.findMany({
        where: eq(orderItems.orderId, orderId),
      });
      const platformFeeAmount = (((order.platformShareCents || 0) * 2) / 100).toFixed(2);
      return { ...order, orderItems: orderItemsList, platformFeeAmount };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Failed to get order:', error);
      throw new ApiError(500, 'Failed to get order');
    }
  }

  static async cancelOrder(orderId, userId) {
    try {
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
      });
      if (!order) throw new ApiError(404, 'Order not found');
      if (order.status !== 'pending')
        throw new ApiError(400, 'Only pending orders can be cancelled');
      const [cancelled] = await db
        .update(orders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(orders.id, orderId))
        .returning();
      return cancelled;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Failed to cancel order:', error);
      throw new ApiError(500, 'Failed to cancel order');
    }
  }

  /**
   * Update an order safely.
   * Supports a whitelist of fields and optional force to bypass ownership checks
   * Returns the updated order and previous status to help callers decide on post-update actions
   */
  static async updateOrder(orderId, userId = null, updates = {}, { force = false } = {}) {
    try {
      if (!orderId) throw new ApiError(400, 'Order ID is required');

      const order = await db.query.orders.findFirst({
        where: eq(orders.id, orderId),
      });
      if (!order) throw new ApiError(404, 'Order not found');

      // Ownership check unless force or userId is null
      if (userId && !force && order.userId !== userId) {
        throw new ApiError(403, 'Not authorized to update this order');
      }

      // Whitelist allowed update fields
      const ALLOWED_UPDATE_FIELDS = [
        'billingAddress',
        'paymentMethodId',
        'receiptUrl',
        'paymentIntentId',
        'status',
      ];

      const updatePayload = {};
      for (const key of Object.keys(updates || {})) {
        if (ALLOWED_UPDATE_FIELDS.includes(key)) {
          // map incoming keys to db columns naming (camelCase -> snake_case) if needed
          updatePayload[key] = updates[key];
        }
      }

      if (Object.keys(updatePayload).length === 0) {
        // Nothing to update; return current order
        return { updatedOrder: order, previousStatus: order.status };
      }

      const previousStatus = order.status;

      // Safe status transitions only
      if (updatePayload.status) {
        const targetStatus = updatePayload.status;
        const allowedTransitions = {
          pending: ['paid', 'cancelled'],
          paid: [],
          cancelled: [],
        };
        const allowed = (allowedTransitions[previousStatus] || []).includes(targetStatus) || force;
        if (!allowed) {
          throw new ApiError(
            400,
            `Cannot transition status from ${previousStatus} to ${targetStatus}`
          );
        }
      }

      // Validate receiptUrl length if present and string
      if (updatePayload.receiptUrl && typeof updatePayload.receiptUrl === 'string') {
        if (updatePayload.receiptUrl.length > 255) {
          // Trim to length to avoid DB errors; alternatively throw an error
          updatePayload.receiptUrl = updatePayload.receiptUrl.slice(0, 255);
        }
      }

      updatePayload.updatedAt = new Date();

      const [updated] = await db
        .update(orders)
        .set(updatePayload)
        .where(eq(orders.id, orderId))
        .returning();
      return { updatedOrder: updated, previousStatus };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Failed to update order:', error);
      throw new ApiError(500, 'Failed to update order');
    }
  }

  /**
   * List orders for a user with pagination, filtering, and sorting
   */
  static async listUserOrders(
    userId,
    {
      page = 1,
      limit = 20,
      status = null,
      year = null,
      month = null,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      eventId = null,
    } = {}
  ) {
    try {
      const { pageNum, limitNum, offset } = normalizePagination(page, limit);

      // Build where conditions
      const whereConditions = [];
      if (userId) {
        whereConditions.push(eq(orders.userId, userId));
      }
      if (eventId) {
        whereConditions.push(eq(orders.eventId, eventId));
      }

      addDateFilters(whereConditions, year, month);
      if (status) {
        whereConditions.push(eq(orders.status, status));
      }

      const whereClause = buildWhereClause(whereConditions);
      const { sortField, sortFn } = normalizeSorting(sortBy, sortOrder);

      // Get total count
      const totalRowsQuery = db.select({ count: count() }).from(orders);
      const totalRows = whereClause
        ? await totalRowsQuery.where(whereClause)
        : await totalRowsQuery;
      const [{ count: totalCount }] = totalRows;

      // Get paginated orders
      const pagedOrdersQuery = db
        .select()
        .from(orders)
        .orderBy(sortFn(orders[sortField]))
        .limit(limitNum)
        .offset(offset);

      const ordersList = whereClause
        ? await pagedOrdersQuery.where(whereClause)
        : await pagedOrdersQuery;

      const ordersWithItems = await OrderService.enrichOrders(ordersList, {
        includeEvent: true,
      });

      const totalPages = Math.ceil(totalCount / limitNum);

      return {
        items: ordersWithItems,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount,
          pages: totalPages,
          hasMore: pageNum < totalPages,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Failed to list user orders:', error);
      throw new ApiError(500, 'Failed to list user orders');
    }
  }

  /**
   * List orders for an event with pagination, filtering, and sorting.
   * Intended for organizer/admin/team members with relevant event permissions.
   */
  static async listEventOrders(
    eventId,
    {
      page = 1,
      limit = DEFAULT_PAGE_LIMIT,
      status = null,
      year = null,
      month = null,
      userId = null,
      paymentMethodId = null,
      minAmount = null,
      maxAmount = null,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = {}
  ) {
    try {
      if (!eventId) throw new ApiError(400, 'Event ID is required');

      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
      });
      if (!event) throw new ApiError(404, 'Event not found');

      const { pageNum, limitNum, offset } = normalizePagination(page, limit);
      const { sortField, sortFn } = normalizeSorting(sortBy, sortOrder);

      const whereConditions = [eq(orders.eventId, eventId)];

      if (status) {
        whereConditions.push(eq(orders.status, status));
      }
      if (userId) {
        whereConditions.push(eq(orders.userId, userId));
      }
      if (paymentMethodId) {
        whereConditions.push(eq(orders.paymentMethodId, paymentMethodId));
      }

      addDateFilters(whereConditions, year, month);

      const minAmountNumber = parseNumber(minAmount);
      const maxAmountNumber = parseNumber(maxAmount);

      if (minAmount !== null && minAmount !== undefined && minAmountNumber === null) {
        throw new ApiError(400, 'minAmount must be a valid number');
      }
      if (maxAmount !== null && maxAmount !== undefined && maxAmountNumber === null) {
        throw new ApiError(400, 'maxAmount must be a valid number');
      }
      if (
        minAmountNumber !== null &&
        maxAmountNumber !== null &&
        minAmountNumber > maxAmountNumber
      ) {
        throw new ApiError(400, 'minAmount cannot be greater than maxAmount');
      }

      if (minAmountNumber !== null) {
        whereConditions.push(gte(orders.totalAmount, minAmountNumber.toFixed(2)));
      }
      if (maxAmountNumber !== null) {
        whereConditions.push(lte(orders.totalAmount, maxAmountNumber.toFixed(2)));
      }

      const whereClause = buildWhereClause(whereConditions);

      const [{ count: totalCount }] = await db
        .select({ count: count() })
        .from(orders)
        .where(whereClause);

      const ordersList = await db
        .select()
        .from(orders)
        .where(whereClause)
        .orderBy(sortFn(orders[sortField]))
        .limit(limitNum)
        .offset(offset);

      const ordersWithDetails = await OrderService.enrichOrders(ordersList, {
        includeUser: true,
      });

      const totalPages = Math.ceil(totalCount / limitNum);

      return {
        event,
        items: ordersWithDetails,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount,
          pages: totalPages,
          hasMore: pageNum < totalPages,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Failed to list event orders:', error);
      throw new ApiError(500, 'Failed to list event orders');
    }
  }

  static async issueTicketsAndMerchandise(orderId, holderInfo = {}) {
    try {
      const order = await db.query.orders.findFirst({
        where: eq(orders.id, orderId),
      });

      if (!order) {
        throw new ApiError(404, 'Order not found');
      }

      if (order.status !== 'paid') {
        throw new ApiError(400, 'Order is not paid');
      }

      const orderItemsList = await db.query.orderItems.findMany({
        where: eq(orderItems.orderId, orderId),
      });

      const event = await db.query.events.findFirst({
        where: eq(events.id, order.eventId),
      });
      if (!event) throw new ApiError(404, 'Event not found');

      const tickets = [];
      const merchandise = [];
      // Map to store purchased item IDs per order item
      const itemIdMapping = new Map();

      for (const item of orderItemsList) {
        if (item.itemType === 'ticket') {
          const ticketTier = await db.query.eventTickets.findFirst({
            where: eq(eventTickets.id, item.itemId),
          });
          if (!ticketTier) {
            console.error(`Ticket tier not found for item ${item.id}`);
            continue;
          }

          const ticketIds = [];
          for (let i = 0; i < item.quantity; i++) {
            const ticketCode = generateTicketCode();
            const qrCodeData = {
              eventId: order.eventId,
              organizerId: event.organizerId,
              ticketCode,
              ticketTierId: item.itemId,
              holderName: holderInfo.holderName || null,
              price: item.price,
              eventStartDate: event.startDate,
              isUsed: false,
              usedAt: null,
              orderId: orderId,
            };

            const [ticket] = await db
              .insert(purchasedTickets)
              .values({
                ticketCode,
                eventId: order.eventId,
                ticketTierId: item.itemId,
                userId: order.userId,
                organizerId: event.organizerId,
                holderName: holderInfo.holderName || null,
                holderPhone: holderInfo.holderPhone || null,
                holderEmail: holderInfo.holderEmail || null,
                price: item.price,
                qrCode: JSON.stringify(qrCodeData),
                status: 'active',
                eventScheduleId: holderInfo.eventScheduleId || null,
                purchasedAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();

            // Generate QR image and upload to S3 (non-blocking on failure)
            try {
              const qrPayload = JSON.stringify(qrCodeData);
              const pngBuffer = await QRCode.toBuffer(qrPayload, {
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
              console.error('QR image generation/upload failed for ticket', ticket.id, err);
            }

            if (event.snsTopicArn && holderInfo.holderPhone) {
              try {
                const subscriptionArn = await subscribeWithRetry(
                  event.snsTopicArn,
                  holderInfo.holderPhone
                );
                await db
                  .update(purchasedTickets)
                  .set({ snsSubscriptionArn: subscriptionArn })
                  .where(eq(purchasedTickets.id, ticket.id));
                ticket.snsSubscriptionArn = subscriptionArn;
              } catch (snsError) {
                console.error('Failed to subscribe ticket holder to SNS topic:', snsError);
              }
            }

            tickets.push(ticket);
            ticketIds.push(ticket.id);
          }

          // Store ticket IDs for this order item
          itemIdMapping.set(item.id, ticketIds);

          // Update ticket tier sold count
          await db
            .update(eventTickets)
            .set({
              quantitySold: sql`${eventTickets.quantitySold} + ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(eq(eventTickets.id, item.itemId));

          if (holderInfo.eventScheduleId) {
            await db
              .update(eventTicketScheduleInventory)
              .set({
                quantitySold: sql`${eventTicketScheduleInventory.quantitySold} + ${item.quantity}`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(eventTicketScheduleInventory.ticketTierId, item.itemId),
                  eq(eventTicketScheduleInventory.scheduleId, holderInfo.eventScheduleId)
                )
              );
          }
        } else if (item.itemType === 'merchandise') {
          const merchItem = await db.query.eventMerchandise.findFirst({
            where: eq(eventMerchandise.id, item.itemId),
          });
          if (!merchItem) {
            console.error(`Merchandise not found for item ${item.id}`);
            continue;
          }
          const merchandiseCode = generateTicketCode();
          const unitPrice = parseFloat(item.price);
          const totalPrice = unitPrice * item.quantity;
          const [purchasedItem] = await db
            .insert(purchasedMerchandise)
            .values({
              merchandiseCode,
              eventId: order.eventId,
              merchandiseId: item.itemId,
              userId: order.userId,
              organizerId: event.organizerId,
              holderName: holderInfo.holderName || null,
              holderPhone: holderInfo.holderPhone || null,
              holderEmail: holderInfo.holderEmail || null,
              quantity: item.quantity,
              unitPrice: unitPrice.toString(),
              totalPrice: totalPrice.toString(),
              status: 'active',
              purchasedAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          merchandise.push(purchasedItem);

          // Store merchandise ID for this order item
          itemIdMapping.set(item.id, [purchasedItem.id]);

          // Update merchandise stock
          await db
            .update(eventMerchandise)
            .set({
              quantityAvailable: merchItem.quantityAvailable - item.quantity,
              updatedAt: new Date(),
            })
            .where(eq(eventMerchandise.id, item.itemId));
        }
      }

      // Update order items with purchased item IDs
      for (const [orderItemId, purchasedIds] of itemIdMapping.entries()) {
        await db
          .update(orderItems)
          .set({
            purchasedItemIds: purchasedIds,
            updatedAt: new Date(),
          })
          .where(eq(orderItems.id, orderItemId));
      }

      return {
        orderId,
        tickets,
        merchandise,
        event,
        totalAmount: order.totalAmount,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Ticket/merchandise issuance error:', error);
      throw new ApiError(500, 'Failed to issue tickets and merchandise');
    }
  }
}
