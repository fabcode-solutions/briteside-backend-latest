import Stripe from 'stripe';
import config from '../config/config.js';
import { catchAsync } from '../utils/catch-async.js';
import { db } from '../db/index.js';
import {
  orders,
  users,
  guestOrders,
  guestOrderItems,
  guestPurchasedTickets,
  eventTickets,
  events,
  venues,
} from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { UserSpendService } from '../services/userSpend.service.js';
import ApiError from '../utils/api-error.js';
import { OrderService } from '../services/order.service.js';
import { buildTicketBundleUrl } from '../utils/helper.js';
import { generateTicketCode } from '../utils/code-generator.js';
import QRCode from 'qrcode';
import { UploadService } from '../services/upload.service.js';
import { DoorSalesService } from '../services/doorSales.service.js';
import { RefundService } from '../services/refund.service.js';
import { SubscriptionService } from '../services/subscription.service.js';
import { GroupSubscriptionService } from '../services/groupSubscription.service.js';
import { GroupCourseService } from '../services/groupCourse.service.js';
import { PriorityMessageService } from '../services/priorityMessage.service.js';
import { TalentSessionService } from '../services/talentSession.service.js';
import { ShopOrderService } from '../services/shop/shopOrder.service.js';
import { ShopCustomOfferService } from '../services/shop/shopCustomOffer.service.js';   
import { priorityMessagePayments } from '../db/schema/priorityMessagePayments.js';
import { stripeConnectAccounts } from '../db/schema/stripeConnect.js';
import {
  sendTicketPurchaseEmail,
  sendRefundConfirmationEmail,
} from '../services/eventMail.helper.js';

let stripe = null;
if (config.stripe?.secretKey) {
  stripe = new Stripe(config.stripe.secretKey);
}

export const stripeWebhookHandler = catchAsync(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = config.stripe?.webhookSecret;

  if (!stripe || !webhookSecret) {
    console.error('Stripe or webhook secret not configured');
    return res.status(503).send('Stripe not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Stripe webhook received:', {
    id: event.id,
    type: event.type,
    metadata: event.data?.object?.metadata,
    objectType: event.data?.object?.object,
  });

  // Acknowledge receipt quickly; process after
  res.status(200).json({ received: true });

  // Process specific events
  try {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object;

      // ── Priority message payment ──────────────────────────────────────────
      if (session.metadata?.type === 'priority_message') {
        const io = req.app.get('io');
        await PriorityMessageService.handleWebhook(session, io);
        return;
      }

      // ── Talent session payment ────────────────────────────────────────────
      if (session.metadata?.type === 'talent_session') {
        const io = req.app.get('io');
        await TalentSessionService.handlePaymentWebhook(session, io);
        return;
      }

          // ── Shop purchase ─────────────────────────────────────────────────────
      if (session.metadata?.type === 'shop') {
        await ShopOrderService.handlePaymentWebhook(session);
        return;
      }

      // ── Shop custom service offer — first installment paid ─────────────────
      if (session.metadata?.type === 'shop_custom_offer') {
        await ShopCustomOfferService.handlePaymentWebhook(session);
        return;
      }
      // ── Shop custom service offer — remaining balance paid by buyer ────────
      // 'shop_custom_offer_completion_retry' is the SCA/3DS fallback Checkout
      // created by _chargeRemainderAndFinalize when the off-session charge for
      // the remaining balance needs buyer authentication. It carries the same
      // metadata and means the same thing — "an offer's remainder was paid" —
      // so it routes to the same handler.
      if (
        session.metadata?.type === 'shop_custom_offer_remainder' ||
        session.metadata?.type === 'shop_custom_offer_completion_retry'
      ) {
        await ShopCustomOfferService.handleRemainderPaymentWebhook(session);
        return;
      }

      // ── Shop custom service offer — ONE milestone funded ──────────────────
      // Stages 2..N of a 'milestones' offer each get their own Checkout
      // session. Stage 1 rides the 'shop_custom_offer' branch above, since it
      // is paid as part of accepting the offer.
      if (session.metadata?.type === 'shop_custom_offer_milestone') {
        await ShopCustomOfferService.handleMilestonePaymentWebhook(session);
        return;
      }

      // ── Shop custom service offer — tip ────────────────────────────────────
      // Was previously unhandled here — createTipCheckout charged the buyer
      // but nothing ever credited the seller. Fixed alongside adding the
      // equivalent talent-session tip flow below.
      if (session.metadata?.type === 'shop_custom_offer_tip') {
        await ShopCustomOfferService.handleTipPaymentWebhook(session);
        return;
      }

      // ── Talent session — tip ───────────────────────────────────────────────
      if (session.metadata?.type === 'talent_session_tip') {
        await TalentSessionService.handleTipPaymentWebhook(session);
        return;
      }

      // Route subscription checkouts to SubscriptionService
      if (session.mode === 'subscription') {
        if (session.metadata?.type === 'group_subscription') {
          console.log('Processing group subscription checkout.session completed', {
            sessionId: session.id,
            subscription: session.subscription,
            metadata: session.metadata,
          });
          await GroupSubscriptionService.handleCheckoutCompleted(session);
        } else {
          await SubscriptionService.handleCheckoutSessionCompleted(session);
        }
      } else if (session.metadata?.type === 'group_course_enrollment') {
        await GroupCourseService.handleCourseCheckoutCompleted(session).catch(err =>
          console.error('[GroupCourse] checkout webhook failed:', err.message)
        );
      } else {
        await handleCheckoutSession(session);
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      // Try group subscription refund sync first; always also run the existing ticket refund handler
      await GroupSubscriptionService.handleRefundWebhook(charge).catch(err =>
        console.error('Group refund webhook sync failed:', err.message)
      );
      await handleRefundEvent(charge);
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      if (session.metadata?.type === 'group_subscription') {
        await GroupSubscriptionService.handleCheckoutExpired(session);
      }

      // ── Talent session — release slot on expiry ───────────────────────────
      if (session.metadata?.type === 'talent_session') {
        await TalentSessionService.handlePaymentExpired(session);
      }

      // ── Shop order — mark abandoned checkout as expired ───────────────────
      if (session.metadata?.type === 'shop') {
        await ShopOrderService.handlePaymentExpired(session);
      }

      // ── Shop custom offer milestone — free the stage up again ─────────────
      // Without this an abandoned checkout would leave that milestone stuck at
      // 'awaiting_payment' forever, and the buyer could never start a new one.
      if (session.metadata?.type === 'shop_custom_offer_milestone') {
        await ShopCustomOfferService.handleMilestoneCheckoutExpired(session);
        return;
      }



      // ── Priority message cancellation ─────────────────────────────────────
      if (session.metadata?.type === 'priority_message' && session.metadata?.paymentId) {
        await db
          .update(priorityMessagePayments)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(
            and(
              eq(priorityMessagePayments.id, session.metadata.paymentId),
              eq(priorityMessagePayments.status, 'pending')
            )
          );
        return;
      }

      await handleExpiredCheckoutSession(session);
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated'
    ) {
      const sub = event.data.object;
      if (sub.metadata?.type === 'group_subscription') {
        await GroupSubscriptionService.handleSubscriptionUpdated(sub);
      } else {
        await SubscriptionService.handleSubscriptionUpdated(sub);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      if (sub.metadata?.type === 'group_subscription') {
        await GroupSubscriptionService.handleSubscriptionDeleted(sub);
      } else {
        await SubscriptionService.handleSubscriptionDeleted(sub);
      }
    } else if (event.type === 'invoice.paid') {
      const paidInvoice = event.data.object;
      if (paidInvoice.subscription) {
        const paidSub = await stripe.subscriptions.retrieve(paidInvoice.subscription);
        if (paidSub.metadata?.type === 'group_subscription') {
          await GroupSubscriptionService.handleInvoicePaid(paidInvoice);
        } else {
          await SubscriptionService.handleInvoicePaid(paidInvoice);
        }
      } else {
        await SubscriptionService.handleInvoicePaid(paidInvoice);
      }
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const stripeSub = await stripe.subscriptions.retrieve(invoice.subscription);
        if (stripeSub.metadata?.type === 'group_subscription') {
          await GroupSubscriptionService.handleInvoicePaymentFailed(invoice);
        } else {
          await SubscriptionService.handleInvoicePaymentFailed(invoice);
        }
      } else {
        await SubscriptionService.handleInvoicePaymentFailed(invoice);
      }
    } else if (event.type === 'account.updated') {
      const account = event.data.object;
      await db
        .update(stripeConnectAccounts)
        .set({
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          onboardingComplete: account.details_submitted,
          updatedAt: new Date(),
        })
        .where(eq(stripeConnectAccounts.stripeAccountId, account.id));
    } else {
      console.log('Unhandled event type:', event.type);
    }
  } catch (processErr) {
    console.error('Error processing webhook event:', processErr);
  }
});

async function handleCheckoutSession(session) {
  const paymentId = session.payment_intent || session.id;
  let order = await db.query.orders.findFirst({
    where: eq(orders.paymentIntentId, paymentId),
  });

  if (!order && session.metadata && session.metadata.orderId) {
    order = await db.query.orders.findFirst({
      where: eq(orders.id, session.metadata.orderId),
    });
  }

  let guestOrder = null;
  if (!order && session.metadata && session.metadata.guestOrderId) {
    guestOrder = await db.query.guestOrders.findFirst({
      where: eq(guestOrders.id, session.metadata.guestOrderId),
    });
  }

  if (!order && !guestOrder) {
    console.warn('Order not found for session:', session.id);
    return;
  }

  if (order && order.status === 'paid') {
    console.log('Order already processed for session:', session.id);
    return;
  }

  let receiptUrl = null;
  let stripeFeeCents = 0;
  let transferId = null;
  if (paymentId && stripe) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent, {
        expand: ['latest_charge.balance_transaction'],
      });
      const charge = paymentIntent.latest_charge;
      if (charge && typeof charge === 'object') {
        receiptUrl = charge.receipt_url ?? null;
        stripeFeeCents = charge.balance_transaction?.fee ?? 0;
        // Records whether Stripe actually created the Connect transfer for this
        // charge, so a cron audit can spot orders where the organizer's cut is
        // stuck in the platform balance.
        transferId = charge.transfer ?? null;
      }
    } catch (err) {
      console.warn('Unable to retrieve PaymentIntent for receiptUrl:', err.message);
    }
  }

  const holderInfo = {
    holderName:
      (session.metadata && session.metadata.holderName) || session.customer_details?.name || null,
    holderEmail:
      (session.customer_details && session.customer_details.email) ||
      (session.metadata && session.metadata.holderEmail) ||
      null,
    holderPhone:
      (session.metadata && session.metadata.holderPhone) || session.customer_details?.phone || null,
    eventScheduleId: (session.metadata && session.metadata.eventScheduleId) || null,
  };

  if (order) {
    const { updatedOrder, previousStatus } = await OrderService.updateOrder(
      order.id,
      null,
      { status: 'paid', paymentIntentId: paymentId, receiptUrl },
      { force: true }
    );

    if (previousStatus === 'paid' && updatedOrder.status === 'paid') {
      console.log('Order already processed (status remained paid) for session:', session.id);
      return;
    }

    if (stripeFeeCents > 0 || transferId) {
      await db
        .update(orders)
        .set({
          ...(stripeFeeCents > 0 && { stripeFeeCents }),
          ...(transferId && { transferId, transferredAt: new Date() }),
        })
        .where(eq(orders.id, order.id));
    }

    let ticketIssueResult = null;
    try {
      ticketIssueResult = await OrderService.issueTicketsAndMerchandise(order.id, holderInfo);
      console.log('Issued tickets & merchandise for order:', order.id);
      if (holderInfo.holderEmail && ticketIssueResult?.tickets?.length > 0) {
        const downloadUrl = `${process.env.API_HOST || 'https://gokyro.com'}/tickets/user`;
        await sendTicketPurchaseEmail(
          holderInfo.holderEmail,
          ticketIssueResult.event,
          ticketIssueResult.tickets,
          ticketIssueResult.event.venue,
          downloadUrl
        );
      }
    } catch (err) {
      console.error('Failed to issue tickets after payment:', err);
    }

    // Record spend — fire-and-forget, payment already confirmed
    UserSpendService.recordSpend({
      userId: order.userId,
      spendType: 'ticket_purchase',
      amountCents: session.amount_total, // actual Stripe charge (includes platform fee)
      referenceId: order.id,
      referenceType: 'order',
      eventId: order.eventId,
      metadata: {
        eventTitle: ticketIssueResult?.event?.title ?? null,
        eventSlug: ticketIssueResult?.event?.slug ?? null,
        itemCount: ticketIssueResult?.tickets?.length ?? 0,
      },
      stripePaymentIntentId: paymentId,
      stripeSessionId: session.id,
      paidAt: new Date(),
    }).catch(err => console.error('[UserSpend] ticket_purchase record failed:', err.message));

    return;
  }

  if (guestOrder) {
    if (guestOrder.status === 'paid') {
      console.log('Guest order already processed for session:', session.id);
      return;
    }

    await db
      .update(guestOrders)
      .set({
        status: 'paid',
        paymentIntentId: paymentId,
        receiptUrl,
        updatedAt: new Date(),
      })
      .where(eq(guestOrders.id, guestOrder.id));

    const guestItems = await db.query.guestOrderItems.findMany({
      where: eq(guestOrderItems.guestOrderId, guestOrder.id),
    });

    const event = await db.query.events.findFirst({
      where: eq(events.id, guestOrder.eventId),
    });
    const venue = event?.venueId
      ? await db.query.venues.findFirst({ where: eq(venues.id, event.venueId) })
      : null;

    const issuedTickets = [];
    for (const item of guestItems) {
      const tier = await db.query.eventTickets.findFirst({
        where: eq(eventTickets.id, item.ticketTierId),
      });
      if (!tier) {
        console.warn('Guest ticket tier not found for item:', item.id);
        continue;
      }

      for (let i = 0; i < item.quantity; i++) {
        const ticketCode = generateTicketCode();

        const qrCodeData = {
          eventId: guestOrder.eventId,
          organizerId: event?.organizerId || null,
          eventStartDate: event?.startDate || null,
          ticketCode,
          ticketTierId: item.ticketTierId,
          holderName: holderInfo.holderName || guestOrder.guestName || null,
          holderEmail: holderInfo.holderEmail || guestOrder.guestEmail || null,
          holderPhone: holderInfo.holderPhone || guestOrder.guestPhone || null,
          price: item.unitPrice,
          orderId: guestOrder.id,
          isGuestTicket: true,
        };

        const [ticket] = await db
          .insert(guestPurchasedTickets)
          .values({
            ticketCode,
            eventId: guestOrder.eventId,
            ticketTierId: item.ticketTierId,
            guestOrderId: guestOrder.id,
            holderName: holderInfo.holderName || guestOrder.guestName || null,
            holderEmail: holderInfo.holderEmail || guestOrder.guestEmail || null,
            holderPhone: holderInfo.holderPhone || guestOrder.guestPhone || null,
            price: item.unitPrice,
            qrCode: JSON.stringify(qrCodeData),
            status: 'active',
            purchasedAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        try {
          const pngBuffer = await QRCode.toBuffer(JSON.stringify(qrCodeData), {
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
            .update(guestPurchasedTickets)
            .set({ qrCodeUrl: uploadRes.url, updatedAt: new Date() })
            .where(eq(guestPurchasedTickets.id, ticket.id));
        } catch (err) {
          console.error('Failed to generate/upload QR for guest ticket', ticket.id, err);
        }

        issuedTickets.push(ticket);
      }
    }

    if (holderInfo.holderEmail) {
      const downloadUrl = buildTicketBundleUrl(guestOrder.id);
      try {
        await sendTicketPurchaseEmail(
          holderInfo.holderEmail,
          event,
          issuedTickets,
          venue || {},
          downloadUrl,
          { receiptUrl, orderId: guestOrder.id }
        );
      } catch (err) {
        console.error('Failed to send guest ticket purchase email:', err);
      }
    }

    return;
  }
}

async function handleRefundEvent(charge) {
  const refundsList = charge.refunds?.data || [];
  if (refundsList.length === 0) {
    console.warn('No refunds found in charge.refunded event');
    return;
  }

  for (const refund of refundsList) {
    try {
      const result = await RefundService.processRefundWebhook(refund.id, refund);
      if (result && result.refund && result.order) {
        console.log('Processed refund webhook for order:', result.order.id);

        const user = await db.query.users.findFirst({
          where: eq(users.id, result.order.userId),
        });

        if (user && user.email) {
          await sendRefundConfirmationEmail(user.email, result.order, result.refund, result.event);
        }
      }
    } catch (err) {
      console.error('Failed to process refund webhook:', refund.id, err);
    }
  }
}

async function handleExpiredCheckoutSession(session) {
  try {
    const paymentId = session.id;

    let order = await db.query.orders.findFirst({
      where: eq(orders.paymentIntentId, paymentId),
    });

    if (!order && session.metadata && session.metadata.orderId) {
      order = await db.query.orders.findFirst({
        where: eq(orders.id, session.metadata.orderId),
      });
    }

    if (!order) {
      console.warn('Order not found for expired session:', session.id);
      return;
    }

    await OrderService.updateOrder(
      order.id,
      null,
      { status: 'cancelled', statusReason: 'Checkout session expired' },
      { force: true }
    );

    console.log('Updated order status to cancelled for expired session:', session.id);
  } catch (err) {
    console.error('Failed to process expired checkout session:', err);
  }
}

export default stripeWebhookHandler;
