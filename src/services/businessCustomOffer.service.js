/**
 * Custom price offers — the business's answer to an inquiry about an "Inquire for
 * pricing" service (or any job that needs its own price), like Digital Services
 * custom offers. Sent from the inquiry chat or from the dashboard to any customer;
 * the customer finds them in My Calendar → Requests (listForCustomer).
 *
 * The business picks a menu service or names a new one (optionally saved to the
 * menu as "Inquire for pricing"), sets price / length / payment terms, and the
 * app posts the offer as a card in the inquiry chat (metadata.businessOfferId —
 * the card always reads the offer from here, so a message can't fake a price).
 * The customer books it through the normal booking flow (?offer=<id>): they pick a
 * time and pay online, booking fee + 5% commission as usual
 * (BusinessBookingService.createCheckout with offerId). Paid → status 'booked'.
 */
import httpStatus from 'http-status';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businessCustomOffers,
  businessServices,
  businessStaff,
  businessLocations,
  businessBookings,
  users,
} from '../db/schema/index.js';
import ApiError from '../utils/api-error.js';
import logger from '../config/logger.js';
import { createNotification } from './notification.service.js';
import { BusinessService } from './business.service.js';
import { calculateBusinessBookingFeeCents } from '../utils/orderProcessingFee.js';

const DEFAULT_EXPIRY_DAYS = 7;
const money = c => `$${(c / 100).toFixed(2)}`;

/** Pending offers past their expiry read as 'expired' (no cron needed). */
const effectiveStatus = o =>
  o.status === 'pending' && o.expiresAt.getTime() < Date.now() ? 'expired' : o.status;

const serializeOffer = (o, extra = {}) => ({
  id: o.id,
  businessId: o.businessId,
  customerId: o.customerId,
  conversationId: o.conversationId ?? null,
  serviceId: o.serviceId ?? null,
  serviceName: o.serviceName,
  description: o.description ?? null,
  durationMins: o.durationMins,
  priceCents: o.priceCents,
  paymentModel: o.paymentModel,
  depositCents: o.depositCents ?? null,
  // Charged on top at booking ($5 / $7 / $10 on the full price)
  customerFeeCents: calculateBusinessBookingFeeCents(o.priceCents),
  locationId: o.locationId ?? null,
  staffId: o.staffId ?? null,
  note: o.note ?? null,
  status: effectiveStatus(o),
  expiresAt: o.expiresAt,
  bookingId: o.bookingId ?? null,
  bookedAt: o.bookedAt ?? null,
  createdAt: o.createdAt,
  ...extra,
});

async function loadOfferForBusiness(business, offerId) {
  const offer = await db.query.businessCustomOffers.findFirst({
    where: and(eq(businessCustomOffers.id, offerId), eq(businessCustomOffers.businessId, business.id)),
  });
  if (!offer) throw new ApiError(httpStatus.NOT_FOUND, 'Offer not found');
  return offer;
}

export class BusinessCustomOfferService {
  static async create(business, user, body) {
    if (business.pageType === 'standard') {
      throw new ApiError(httpStatus.CONFLICT, 'Switch your page to Appointments to send custom prices');
    }
    if (body.customerId === business.ownerId) {
      throw new ApiError(httpStatus.BAD_REQUEST, "You can't send an offer to yourself");
    }
    const customer = await db.query.users.findFirst({
      where: eq(users.id, body.customerId),
      columns: { id: true, firstName: true, lastName: true },
    });
    if (!customer) throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');

    if (body.staffId) {
      const staff = await db.query.businessStaff.findFirst({
        where: and(
          eq(businessStaff.id, body.staffId),
          eq(businessStaff.businessId, business.id),
          isNull(businessStaff.deletedAt)
        ),
        columns: { id: true },
      });
      if (!staff) throw new ApiError(httpStatus.BAD_REQUEST, 'That staff member no longer exists');
    }
    if (body.locationId) {
      const location = await db.query.businessLocations.findFirst({
        where: and(
          eq(businessLocations.id, body.locationId),
          eq(businessLocations.businessId, business.id),
          isNull(businessLocations.deletedAt)
        ),
        columns: { id: true },
      });
      if (!location) throw new ApiError(httpStatus.BAD_REQUEST, 'That location no longer exists');
    }

    // The service it's for: a menu service, or a new one (saved to the menu when asked)
    let serviceId = null;
    let serviceName;
    let categoryName = null;
    if (body.serviceId) {
      const service = await db.query.businessServices.findFirst({
        where: and(
          eq(businessServices.id, body.serviceId),
          eq(businessServices.businessId, business.id),
          isNull(businessServices.deletedAt)
        ),
        columns: { id: true, name: true, sessionType: true },
      });
      if (!service) throw new ApiError(httpStatus.NOT_FOUND, 'That service no longer exists');
      if (service.sessionType === 'group') {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Group classes are booked by the seat. Create a new service for this customer's price instead."
        );
      }
      serviceId = service.id;
      serviceName = service.name;
    } else {
      serviceName = body.newService.name;
      categoryName = body.newService.categoryName || null;
      if (body.newService.addToMenu) {
        const created = await BusinessService.createService(business, {
          name: serviceName,
          description: body.description ?? null,
          categoryName,
          durationMins: body.durationMins,
          priceCents: body.priceCents,
          priceOnRequest: true,
        });
        serviceId = created.id;
      }
    }

    const expiresAt = new Date(Date.now() + (body.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 86_400_000);
    const [offer] = await db
      .insert(businessCustomOffers)
      .values({
        businessId: business.id,
        customerId: customer.id,
        conversationId: body.conversationId ?? null,
        serviceId,
        serviceName,
        description: body.description || null,
        durationMins: body.durationMins,
        priceCents: body.priceCents,
        paymentModel: body.paymentModel,
        depositCents: body.paymentModel === 'deposit' ? (body.depositCents ?? null) : null,
        locationId: body.locationId ?? null,
        staffId: body.staffId ?? null,
        note: body.note || null,
        expiresAt,
        createdBy: user?.id ?? null,
      })
      .returning();

    try {
      await createNotification({
        userId: customer.id,
        title: `Custom price from ${business.name}`,
        message: `${serviceName}: ${money(offer.priceCents)}. Book a time before it expires.`,
        type: 'business_booking',
        // My Calendar → Requests lists it with Book a time / Decline
        redirectTo: '/bookings?tab=requests',
        relatedId: offer.id,
        metadata: { businessId: business.id, offerId: offer.id },
      });
    } catch (err) {
      logger.error(`[businessOffer] customer notification failed: ${err.message}`);
    }

    return serializeOffer(offer, { addedToMenu: !!body.newService?.addToMenu });
  }

  /** Dashboard: offers sent, newest first, with totals for the metrics. */
  static async listForBusiness(business, { customerId, limit = 200 } = {}) {
    const rows = await db.query.businessCustomOffers.findMany({
      where: and(
        eq(businessCustomOffers.businessId, business.id),
        ...(customerId ? [eq(businessCustomOffers.customerId, customerId)] : [])
      ),
      with: { customer: { columns: { id: true, firstName: true, lastName: true, username: true } } },
      orderBy: [desc(businessCustomOffers.createdAt)],
      limit,
    });
    const offers = rows.map(o =>
      serializeOffer(o, {
        customerName: [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || o.customer?.username || 'Customer',
      })
    );
    const by = s => offers.filter(o => o.status === s);
    const booked = by('booked');
    const decided = offers.filter(o => o.status !== 'pending');
    return {
      offers,
      summary: {
        sent: offers.length,
        pending: by('pending').length,
        booked: booked.length,
        declined: by('declined').length,
        withdrawn: by('withdrawn').length,
        expired: by('expired').length,
        // Share of offers that ended in a booking (open ones not counted yet)
        acceptanceRate: decided.length ? Math.round((booked.length / decided.length) * 100) : 0,
        bookedValueCents: booked.reduce((s, o) => s + o.priceCents, 0),
        pendingValueCents: by('pending').reduce((s, o) => s + o.priceCents, 0),
      },
    };
  }

  /**
   * Customer side (My Calendar → Requests): custom prices businesses sent this
   * user, newest first, shaped like the chat card's offer (role 'customer').
   * 'pending' = still bookable (open and not past its expiry).
   */
  static async listForCustomer(user, { status = 'pending', limit = 100 } = {}) {
    const rows = await db.query.businessCustomOffers.findMany({
      where: and(
        eq(businessCustomOffers.customerId, user.id),
        ...(status === 'pending' ? [eq(businessCustomOffers.status, 'pending')] : [])
      ),
      with: {
        business: { columns: { id: true, slug: true, name: true, logoUrl: true } },
        location: { columns: { id: true, name: true } },
        staff: { columns: { id: true, name: true } },
      },
      orderBy: [desc(businessCustomOffers.createdAt)],
      limit,
    });
    const offers = rows
      .filter(o => o.business)
      .map(o =>
        serializeOffer(o, {
          role: 'customer',
          business: {
            id: o.business.id,
            slug: o.business.slug,
            name: o.business.name,
            logoUrl: o.business.logoUrl ?? null,
          },
          locationName: o.location?.name ?? null,
          staffName: o.staff?.name ?? null,
        })
      );
    // Expiry is computed on read, so drop the ones that lapsed since they were stored as open
    return status === 'pending' ? offers.filter(o => o.status === 'pending') : offers;
  }

  static async withdraw(business, offerId) {
    const offer = await loadOfferForBusiness(business, offerId);
    if (effectiveStatus(offer) !== 'pending') {
      throw new ApiError(httpStatus.CONFLICT, 'Only open offers can be withdrawn');
    }
    // An unpaid checkout in progress stops holding its slot (a late payment is refunded)
    const now = new Date();
    const [row] = await db
      .update(businessCustomOffers)
      .set({ status: 'withdrawn', withdrawnAt: now, updatedAt: now })
      .where(and(eq(businessCustomOffers.id, offer.id), eq(businessCustomOffers.status, 'pending')))
      .returning();
    if (!row) throw new ApiError(httpStatus.CONFLICT, 'This offer was just booked');
    await db
      .update(businessBookings)
      .set({ status: 'expired', updatedAt: now })
      .where(and(eq(businessBookings.customOfferId, offer.id), eq(businessBookings.status, 'awaiting_payment')));
    return serializeOffer(row);
  }

  /**
   * The offer as the chat card shows it — to the customer it was sent to, or to the
   * business owner. Includes what the card needs to link to booking.
   */
  static async getForUser(user, offerId) {
    const offer = await db.query.businessCustomOffers.findFirst({
      where: eq(businessCustomOffers.id, offerId),
      with: {
        business: { columns: { id: true, slug: true, name: true, logoUrl: true, ownerId: true } },
        location: { columns: { id: true, name: true } },
        staff: { columns: { id: true, name: true } },
      },
    });
    const isCustomer = offer?.customerId === user.id;
    const isBusiness = offer?.business?.ownerId === user.id;
    if (!offer || (!isCustomer && !isBusiness)) throw new ApiError(httpStatus.NOT_FOUND, 'Offer not found');
    return serializeOffer(offer, {
      role: isBusiness ? 'business' : 'customer',
      business: {
        id: offer.business.id,
        slug: offer.business.slug,
        name: offer.business.name,
        logoUrl: offer.business.logoUrl ?? null,
      },
      locationName: offer.location?.name ?? null,
      staffName: offer.staff?.name ?? null,
    });
  }

  static async decline(user, offerId) {
    const offer = await db.query.businessCustomOffers.findFirst({
      where: and(eq(businessCustomOffers.id, offerId), eq(businessCustomOffers.customerId, user.id)),
      with: { business: { columns: { id: true, ownerId: true, name: true } } },
    });
    if (!offer) throw new ApiError(httpStatus.NOT_FOUND, 'Offer not found');
    if (effectiveStatus(offer) !== 'pending') {
      throw new ApiError(httpStatus.CONFLICT, 'This offer can no longer be declined');
    }
    const now = new Date();
    const [row] = await db
      .update(businessCustomOffers)
      .set({ status: 'declined', declinedAt: now, updatedAt: now })
      .where(and(eq(businessCustomOffers.id, offer.id), eq(businessCustomOffers.status, 'pending')))
      .returning();
    if (!row) throw new ApiError(httpStatus.CONFLICT, 'This offer can no longer be declined');
    try {
      await createNotification({
        userId: offer.business.ownerId,
        title: 'Custom price declined',
        message: `Your ${money(offer.priceCents)} offer for ${offer.serviceName} was declined.`,
        type: 'business_booking',
        redirectTo: '/business/dashboard',
        relatedId: offer.id,
        metadata: { businessId: offer.business.id, offerId: offer.id, kind: 'change' },
      });
    } catch (err) {
      logger.error(`[businessOffer] owner notification failed: ${err.message}`);
    }
    return serializeOffer(row);
  }
}
