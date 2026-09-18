/**
 * src/controllers/priorityMessage.controller.js
 */

import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { PriorityMessageService } from '../services/priorityMessage.service.js';
import Stripe from 'stripe';
import config from '../config/config.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;
const WEBHOOK_SECRET =
  process.env.STRIPE_PRIORITY_MESSAGE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

// ─── POST /priority-messages ──────────────────────────────────────────────────

/**
 * Initiate a priority message checkout session.
 * Auth required — must be the sender.
 *
 * Body: { talentProfileId, subject?, messageContent }
 * Returns: { checkoutUrl, paymentId }
 */
export const createCheckout = catchAsync(async (req, res) => {
  const {
    talentProfileId,
    subject,
    messageContent,
    messages,
    platform,
    contentExtended,
    attachmentIds,
  } = req.body;

  if (!talentProfileId) throw new ApiError(400, '`talentProfileId` is required');

  // Accept either messages[] array or legacy single-message fields
  const hasArray = Array.isArray(messages) && messages.length > 0;
  const hasSingle = messageContent?.trim();
  if (!hasArray && !hasSingle) {
    throw new ApiError(400, '`messages` array or `messageContent` is required');
  }
  const firstMessageText = hasSingle
    ? messageContent.trim()
    : (messages?.[0]?.content?.trim() || messages?.[0]?.messageContent?.trim() || '');
  const derivedSubject = firstMessageText
    ? firstMessageText.slice(0, 60) + (firstMessageText.length > 60 ? '…' : '')
    : null;

  const result = await PriorityMessageService.createCheckout(req.user.id, {
    talentProfileId,
    subject: subject?.trim() || derivedSubject,
    messageContent: messageContent?.trim() || null,
    messages,
    platform,
    contentExtended,
    attachmentIds,
  });

  res.status(201).json({ success: true, data: result });
});

export const stripeWebhook = catchAsync(async (req, res) => {
  if (!stripe || !WEBHOOK_SECRET) {
    console.error('[PriorityMessage] Stripe not configured');
    return res.status(503).send('Not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[PriorityMessage] Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Acknowledge immediately
  res.status(200).json({ received: true });
  const io = req.app.get('io');
  const session = event.data.object;

  // Only handle our priority_message type
  if (session.metadata?.type !== 'priority_message') return;

  try {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      await PriorityMessageService.handleWebhook(session, io);
    } else if (event.type === 'checkout.session.expired') {
      // Mark payment cancelled if it's still pending
      if (session.metadata?.paymentId) {
        const { db } = await import('../db/index.js');
        const { priorityMessagePayments } = await import('../db/schema/priorityMessagePayments.js');
        const { eq, and } = await import('drizzle-orm');

        await db
          .update(priorityMessagePayments)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(
            and(
              eq(priorityMessagePayments.id, session.metadata.paymentId),
              eq(priorityMessagePayments.status, 'pending')
            )
          );
      }
    }
  } catch (err) {
    console.error('[PriorityMessage] Webhook processing error:', err.message);
  }
});

// ─── GET /priority-messages/:paymentId/status ────────────────────────────────

/**
 * Poll payment + delivery status after Stripe redirect.
 * Auth required.
 */
export const getPaymentStatus = catchAsync(async (req, res) => {
  const result = await PriorityMessageService.getStatus(req.params.paymentId, req.user.id);
  res.json({ success: true, data: result });
});

// ─── GET /priority-messages/received ────────────────────────────────────────

/**
 * Talent views all paid priority messages sent to them.
 * Auth required.
 * Query: page, limit
 */
export const getReceivedMessages = catchAsync(async (req, res) => {
  const { page, limit } = req.query;

  const result = await PriorityMessageService.getReceivedMessages(req.user.id, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 20,
  });

  res.json({ success: true, data: result });
});
export const getPriorityConversations = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, onlyOutstanding } = req.query;
  const result = await PriorityMessageService.getPriorityConversations(req.user.id, {
    page: parseInt(page),
    limit: parseInt(limit),
    onlyOutstanding: onlyOutstanding === 'true',
  });
  res.json({ success: true, data: result });
});

export const getConversationSpend = catchAsync(async (req, res) => {
  const result = await PriorityMessageService.getConversationSpend(
    req.user.id,
    req.params.conversationId
  );
  res.json({ success: true, data: result });
});

// GET /priority-messages/conversations/:conversationId/banner
export const getConversationBanner = catchAsync(async (req, res) => {
  const result = await PriorityMessageService.getConversationBanner(
    req.user.id,
    req.params.conversationId
  );
  res.json({ success: true, data: result });
});
export const getTalentProfileForConversation = catchAsync(async (req, res) => {
  const result = await PriorityMessageService.getTalentProfileForConversation(
    req.user.id,
    req.params.conversationId
  );
  res.json({ success: true, data: result });
});
export const getTotalEarned = catchAsync(async (req, res) => {
  const { senderId } = req.query;
  const result = await PriorityMessageService.getTotalEarned(req.user.id, { senderId });
  res.json({ success: true, data: result });
});
export const getTotalSpent = catchAsync(async (req, res) => {
  const result = await PriorityMessageService.getTotalSpent(req.user.id);
  res.json({ success: true, data: result });
});

export const markAttachmentViewed = catchAsync(async (req, res) => {
  const result = await PriorityMessageService.markAttachmentViewed(
    req.params.attachmentId,
    req.user.id
  );
  res.json({ success: true, ...result });
});
export async function getItemStatuses(req, res, next) {
  try {
    const map = await PriorityMessageService.getItemStatuses(
      req.user.id,
      req.params.conversationId
    );
    res.json({ data: map });
  } catch (err) {
    next(err);
  }
}

export const getPendingStatus = catchAsync(async (req, res) => {
  const pending = await PriorityMessageService.hasPendingMessage(
    req.user.id,
    req.params.talentProfileId
  );
  res.json({ data: { pending } });
});