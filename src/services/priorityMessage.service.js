/**
 *
 * Full priority message payment lifecycle:
 *   createCheckout()    — sender initiates payment via Stripe Checkout
 *   handleWebhook()     — Stripe confirms payment → deliver message to conversation
 *   getStatus()         — poll payment status after redirect
 *   getEarningsSummary()  — talent's aggregate earnings stats (dashboard)
 *   getReceivedMessages() — paginated list of paid messages received by talent
 */

import Stripe from 'stripe';
import { eq, and, ne, inArray, sql, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  priorityMessagePayments,
  priorityMessageItems,
} from '../db/schema/priorityMessagePayments.js';
import { priorityMessageAttachments } from '../db/schema/priorityMessageAttachments.js';
import { media, mediaOwners } from '../db/schema/fileTracking.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { users } from '../db/schema/index.js';
import { socialMessages } from '../db/schema/socialChat.js';
import { SocialChatService } from './socialChat.service.js';
import { SubscriptionService } from './subscription.service.js';
import { FEATURES } from '../constants/features.js';
import { createNotification } from './notification.service.js';
import { UserSpendService } from './userSpend.service.js';
import * as mailService from './mail.service.js';
import ApiError from '../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';
import { MediaModerationService } from './moderation/mediaModeration.service.js';
import config from '../config/config.js';
import { StripeConnectService } from './stripeConnect.service.js';
import { getRedirectUrls } from '../utils/redirect-urls.js';
import { socialConversations } from '../db/schema/socialChat.js';
import { calculatePlatformAndServiceFeeCents } from '../utils/orderProcessingFee.js';

const stripe = config.stripe?.secretKey ? new Stripe(config.stripe.secretKey) : null;

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3330';
const WEBHOOK_SECRET =
  process.env.STRIPE_PRIORITY_MESSAGE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

// The talent's guaranteed-reply SLA window. A reply landing after this closes
// the item out as 'expired' instead of 'replied' — no money changes hands —
// and the cron (processExpiredRefunds) refunds the sender for whatever is
// still unreplied once it elapses. Shared by releaseOnReply() and the cron so
// the two can never disagree about when the window closes.
const REPLY_WINDOW_MS = 72 * 60 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// ─── Service ──────────────────────────────────────────────────────────────────

export class PriorityMessageService {
  // ── Create Stripe Checkout for a priority message ─────────────────────────

  /**
   * POST /priority-messages
   *
   * Creates a Stripe Checkout session. The message is NOT sent yet.
   * It will be delivered by handleWebhook() after payment is confirmed.
   *
   * @param {string} senderId
   * @param {{ talentProfileId, subject, messageContent }} input
   * @returns {{ checkoutUrl, paymentId }}
   */
  static async createCheckout(
    senderId,
    { talentProfileId, subject, messageContent, messages, platform, contentExtended, attachmentIds }
  ) {
    if (!stripe) throw new ApiError(503, 'Payment processing is not configured');

    const deriveSubject = text => {
      const trimmed = (text || '').trim();
      if (!trimmed) return null;
      return trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
    };

    // Normalise: support both old single-message API and new array API
    let msgList = [];
    if (Array.isArray(messages) && messages.length > 0) {
      msgList = messages.map(m => {
        const content = m.messageContent?.trim() || '';
        return {
          subject: m.subject?.trim() || deriveSubject(content),
          messageContent: content,
          contentExtended: m.contentExtended?.trim() || null,
          attachmentIds: Array.isArray(m.attachmentIds) ? m.attachmentIds.slice(0, 5) : [],
        };
      });
    } else if (messageContent) {
      // backward-compat single message
      const content = messageContent.trim();
      msgList = [
        {
          subject: subject?.trim() || deriveSubject(content),
          messageContent: content,
          contentExtended: contentExtended?.trim() || null,
          attachmentIds: Array.isArray(attachmentIds) ? attachmentIds.slice(0, 5) : [],
        },
      ];
    }

    if (msgList.length === 0) throw new ApiError(400, 'At least one message is required');
    if (msgList.length > 10) throw new ApiError(400, 'Maximum 10 messages per checkout');
    if (msgList.some(m => !m.messageContent && m.attachmentIds.length === 0)) {
      throw new ApiError(400, 'Each message must have content or at least one attachment');
    }

    for (let i = 0; i < msgList.length; i++) {
      const m = msgList[i];
      if (m.messageContent.length > 280) {
        throw new ApiError(
          400,
          `Message ${i + 1} base content exceeds 280 characters (${m.messageContent.length} chars)`
        );
      }
      if (m.contentExtended && m.contentExtended.length > 1400) {
        throw new ApiError(
          400,
          `Message ${i + 1} extended content exceeds 1400 characters (${m.contentExtended.length} chars)`
        );
      }
    }

    const messagesModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.MESSAGE,
      entityCreatorId: senderId,
      texts: msgList.flatMap(m => [m.subject, m.messageContent, m.contentExtended]),
    });

    const allAttachmentIds = msgList.flatMap(m => m.attachmentIds);
    if (allAttachmentIds.length > 0) {
      if (allAttachmentIds.some(id => typeof id !== 'string')) {
        throw new ApiError(400, 'Invalid attachment ID format');
      }
      if (msgList.some(m => m.attachmentIds.length > 5)) {
        throw new ApiError(400, 'Maximum 5 attachments per message');
      }

      const uniqueAttachmentIds = new Set(allAttachmentIds);

      const attachedFiles = await db.query.media.findMany({
        where: inArray(media.id, allAttachmentIds),
        columns: {
          id: true,
          url: true,
          s3Key: true,
          originalName: true,
          mimetype: true,
          size: true,
          deletedAt: true,
        },
      });

      // Compare against the count of unique IDs, not the raw (possibly repeated)
      // list — the same attachment can be reused across multiple messages, and
      // the DB query naturally returns one row per matching ID regardless of
      // how many times that ID appears in allAttachmentIds.
      if (attachedFiles.length !== uniqueAttachmentIds.size) {
        throw new ApiError(400, 'One or more attachments not found or do not belong to you');
      }

      // Ownership is tracked via mediaOwners, not media.uploadedBy — content-hash
      // dedup means the same media row can be shared by multiple uploaders.
      const ownedRows = await db.query.mediaOwners.findMany({
        where: and(
          inArray(mediaOwners.mediaId, [...uniqueAttachmentIds]),
          eq(mediaOwners.userId, senderId)
        ),
        columns: { mediaId: true },
      });
      const ownedIds = new Set(ownedRows.map(r => r.mediaId));
      if ([...uniqueAttachmentIds].some(id => !ownedIds.has(id))) {
        throw new ApiError(400, 'One or more attachments not found or do not belong to you');
      }
      if (attachedFiles.some(f => f.deletedAt)) {
        throw new ApiError(400, 'One or more attachments have been deleted');
      }

      const fileMap = new Map(attachedFiles.map(f => [f.id, f]));
      for (const m of msgList) {
        m.attachments = m.attachmentIds.map(id => fileMap.get(id));
      }
    } else {
      for (const m of msgList) {
        m.attachments = [];
      }
    }

    const profile = await db.query.talentProfiles.findFirst({
      where: and(eq(talentProfiles.id, talentProfileId), eq(talentProfiles.isActive, true)),
      with: {
        user: {
          columns: { id: true, firstName: true, lastName: true, email: true, username: true },
        },
      },
    });
    if (!profile) throw new ApiError(404, 'Talent not found or not accepting messages');
    if (profile.userId === senderId) throw new ApiError(400, 'You cannot message yourself');

    // Talent must have an active subscription with the priority_messaging feature,
    // otherwise they cannot read the message — don't take the sender's money.
    const canReceive = await SubscriptionService.checkFeatureAccess(
      profile.userId,
      FEATURES.PRIORITY_MESSAGING
    );
    if (!canReceive) {
      throw new ApiError(403, 'This talent is not currently accepting priority messages');
    }

    // One outstanding paid message per talent at a time — the sender must wait
    // for the talent's reply (status → 'replied') or the 72h auto-refund
    // (status → 'refunded'/'partial_refunded') before paying for another.
    if (await this.hasPendingMessage(senderId, talentProfileId)) {
      throw new ApiError(
        403,
        'You already have a message pending reply with this talent. Wait for their reply or for it to expire before sending another.'
      );
    }

    // ── Units ──────────────────────────────────────────────────────────────
    const textMessageCount = msgList.filter(
      m => m.messageContent && m.messageContent.length > 0
    ).length;
    const totalExtensionUnits = msgList.reduce((sum, m) => {
      if (!m.contentExtended) return sum;
      return sum + Math.ceil(m.contentExtended.length / 280);
    }, 0);
    const totalUnits = textMessageCount + totalExtensionUnits;

    // ── Attachment fees ──────────────────────────────────────────────────
    const ATTACHMENT_PRICE_CENTS = 99;
    const totalAttachments = msgList.reduce((sum, m) => sum + (m.attachments?.length || 0), 0);
    const totalAttachmentCents = totalAttachments * ATTACHMENT_PRICE_CENTS;

    // ── Base cost (message/extension units + attachments) ──────────────────
    // Attachments are folded into base so they get the same 95/5 talent/platform
    // split as message content — talent earns 95% of attachment price too.
    const baseCents = profile.priorityMessageFee * totalUnits + totalAttachmentCents;

    // Merged "Platform & Service Fee" (7.5% of base) — 100% Briteside revenue.
    const platformAndServiceFeeCents = calculatePlatformAndServiceFeeCents(baseCents);

    // Talent's cut is 95% of base — includes their share of attachment price.
    // This is a separate marketplace commission, unrelated to the Platform &
    // Service Fee, and is unaffected by it.
    const talentDeductionCents = Math.round(baseCents * 0.05);
    const talentNetCents = baseCents - talentDeductionCents;

    // What the sender is charged — base + the merged fee. Stripe's own
    // processing cost is not passed to the sender via a gross-up.
    const chargedCents = baseCents + platformAndServiceFeeCents;

    // Stripe's actual processing cost is a separate, Briteside-absorbed expense —
    // tracked here as an estimate for reporting only, never charged to the sender
    // or deducted from the talent's Connect transfer.
    const estimatedStripeFeeCents = Math.round(chargedCents * 0.029) + 30;

    // Platform keeps: the Platform & Service Fee (100% Briteside revenue) +
    // talent's 5% marketplace commission. Stripe's cost comes out of
    // Briteside's own revenue.
    const applicationFeeCents = platformAndServiceFeeCents + talentDeductionCents;

    const talentName = `${profile.user.firstName} ${profile.user.lastName}`;

    const sender = await db.query.users.findFirst({
      where: eq(users.id, senderId),
      columns: { firstName: true, lastName: true, email: true },
    });

    // ── Persist payment + items + attachments in one transaction ───────────
    const { payment, items } = await db.transaction(async tx => {
      const [paymentRow] = await tx
        .insert(priorityMessagePayments)
        .values({
          senderId,
          talentProfileId,
          talentUserId: profile.userId,
          messageCount: msgList.length,
          amountCents: chargedCents,
          baseCents,
          status: 'pending',
          metadata: {
            platformAndServiceFeeCents,
            talentDeductionCents,
            talentNetCents,
            applicationFeeCents,
            estimatedStripeFeeCents,
            totalExtensionUnits,
            totalUnits,
            totalAttachments,
            totalAttachmentCents,
          },
        })
        .returning();

      const itemRows = await tx
        .insert(priorityMessageItems)
        .values(
          msgList.map((m, idx) => ({
            paymentId: paymentRow.id,
            position: idx,
            subject: m.subject,
            messageContent: m.messageContent,
            contentExtended: m.contentExtended ?? null,
          }))
        )
        .returning();

      const allAttachRows = [];
      for (const m of msgList) {
        for (const file of m.attachments) {
          allAttachRows.push({
            paymentId: paymentRow.id,
            itemId: null,
            mediaId: file.id,
            uploadedBy: senderId,
            url: file.url,
            s3Key: file.s3Key,
            originalName: file.originalName,
            mimetype: file.mimetype,
            sizeBytes: file.size,
            priceCents: ATTACHMENT_PRICE_CENTS,
            status: 'pending',
          });
        }
      }

      if (allAttachRows.length > 0) {
        await tx.insert(priorityMessageAttachments).values(allAttachRows);
      }

      return { payment: paymentRow, items: itemRows };
    });

    // The moderation check above covers the whole batch as one verdict (Stream
    // has no per-message granularity for a single check() call) — if it came
    // back flagged, run the masking pass per item so each priority_message_item
    // gets its own text_moderation row (recordIfFlagged is itself a no-op for any
    // item whose subject/messageContent/contentExtended matched nothing).
    await Promise.all(
      items.map(item =>
        TextModerationService.recordIfFlagged(messagesModeration, {
          entityType: TEXT_ENTITY.MESSAGE,
          entityId: item.id,
          userId: senderId,
          fieldNames: ['subject', 'messageContent', 'contentExtended'],
          texts: [item.subject, item.messageContent, item.contentExtended],
        })
      )
    );

    const { successUrl, cancelUrl } = getRedirectUrls(
      platform,
      FRONTEND_URL,
      `/talent/${profile.user.username}`,
      `/profile/${profile.user.username}`
    );

    // ── Stripe Checkout session ─────────────────────────────────────────────
    const checkoutParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: [
        // Base message (only if there's actual text content)
        ...(textMessageCount > 0
          ? [
              {
                price_data: {
                  currency: 'usd',
                  unit_amount: profile.priorityMessageFee * textMessageCount,
                  product_data: {
                    name:
                      msgList.length > 1
                        ? `${msgList.length} Priority Messages to ${talentName}`
                        : `Priority Message to ${talentName}`,
                    description: 'Guaranteed response within 72 hours',
                  },
                },
                quantity: 1,
              },
            ]
          : []),

        // Extended content
        ...(totalExtensionUnits > 0
          ? [
              {
                price_data: {
                  currency: 'usd',
                  unit_amount: profile.priorityMessageFee * totalExtensionUnits,
                  product_data: {
                    name:
                      totalExtensionUnits > 1
                        ? `Extended message content (${totalExtensionUnits} blocks)`
                        : 'Extended message content',
                    description: `Adds ${totalExtensionUnits * 280} extra characters to your message`,
                  },
                },
                quantity: 1,
              },
            ]
          : []),

        // Attachments
        ...(totalAttachments > 0
          ? [
              {
                price_data: {
                  currency: 'usd',
                  unit_amount: totalAttachmentCents,
                  product_data: {
                    name: totalAttachments > 1 ? `${totalAttachments} Attachments` : '1 Attachment',
                    description: `${totalAttachments} file${totalAttachments > 1 ? 's' : ''} attached — 99¢ each, refunded if not opened within 48h`,
                  },
                },
                quantity: 1,
              },
            ]
          : []),

        // Merged Platform & Service Fee (7.5% of base) — shows even for
        // attachment-only sends, whenever there's any charge.
        ...(platformAndServiceFeeCents > 0
          ? [
              {
                price_data: {
                  currency: 'usd',
                  unit_amount: platformAndServiceFeeCents,
                  product_data: { name: 'Platform & Service Fee' },
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(sender?.email?.trim() ? { customer_email: sender.email.trim() } : {}),
      metadata: {
        type: 'priority_message',
        feature: 'priority_message',
        paymentId: payment.id,
        senderId,
        talentProfileId,
        talentUserId: profile.userId,
        talentName,
      },
      // No transfer_data/application_fee_amount here on purpose — the
      // talent's cut is no longer transferred at charge time. It's held on
      // the platform's own Stripe balance (reserveAmountCents, set in the
      // payment webhook) and moved to the talent's Connect account by a
      // scheduled job 48h after the talent replies, per the SLA escrow
      // payout rule.
      payment_intent_data: {
        metadata: {
          type: 'priority_message',
          feature: 'priority_message',
          paymentId: payment.id,
          talentUserId: profile.userId,
        },
      },
    };

    const session = await stripe.checkout.sessions.create(checkoutParams);

    await db
      .update(priorityMessagePayments)
      .set({ stripeSessionId: session.id, updatedAt: new Date() })
      .where(eq(priorityMessagePayments.id, payment.id));

    return {
      checkoutUrl: session.url,
      paymentId: payment.id,
      messageCount: msgList.length,
      totalUnits,
      totalExtensionUnits,
      totalAttachments,
      baseCents,
      chargedCents,
      messages: msgList.map((m, idx) => ({
        position: idx,
        charLimit: 280 + (m.contentExtended ? m.contentExtended.length : 0),
        extensionUnits: m.contentExtended ? Math.ceil(m.contentExtended.length / 280) : 0,
        attachmentCount: m.attachments.length,
      })),
    };
  }

  // ── Handle Stripe webhook after payment confirmed ─────────────────────────

  /**
   * Called from the webhook controller when checkout.session.completed fires
   * AND metadata.type === 'priority_message'.
   *
   * Delivers the stored message to the conversation and marks the payment paid.
   */
  static async handleWebhook(stripeSession, io = null) {
    console.log('[handleWebhook] called, io:', !!io);
    const { paymentId, senderId, talentUserId } = stripeSession.metadata ?? {};
    console.log('[handleWebhook] paymentId:', paymentId, 'status check...');
    if (!paymentId) return;

    const payment = await db.query.priorityMessagePayments.findFirst({
      where: eq(priorityMessagePayments.id, paymentId),
    });
    if (!payment || payment.status === 'paid') return;
    try {
      const conversation = await SocialChatService.getOrCreateConversation(senderId, talentUserId);

      // Pull the drafted messages from the items table — this is what was
      // missing. payment.messages no longer exists.
      const items = await db.query.priorityMessageItems.findMany({
        where: eq(priorityMessageItems.paymentId, payment.id),
        orderBy: (i, { asc }) => [asc(i.position)],
      });
      if (items.length === 0) {
        console.error(
          `[PriorityMessage] No items found for payment ${payment.id} — nothing to deliver`
        );
        await db
          .update(priorityMessagePayments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(priorityMessagePayments.id, payment.id));
        return;
      }

      // Fetch attachments once before the loop — embedded in each item's message metadata
      const paymentAttachments = await db.query.priorityMessageAttachments.findMany({
        where: and(
          eq(priorityMessageAttachments.paymentId, payment.id),
          eq(priorityMessageAttachments.status, 'pending')
        ),
        columns: {
          id: true,
          url: true,
          originalName: true,
          mimetype: true,
          sizeBytes: true,
          mediaId: true,
        },
      });
      const attachmentModerationMap = await MediaModerationService.statusesByMediaIds(
        paymentAttachments.map(a => a.mediaId)
      );
      const priorityAttachmentsPayload = paymentAttachments.map(a => ({
        id: a.id,
        url: a.url,
        originalName: a.originalName,
        mimetype: a.mimetype,
        sizeBytes: a.sizeBytes,
        status: a.status,
        viewedAt: a.viewedAt ?? null,
        moderationStatus: attachmentModerationMap.get(a.mediaId) ?? 'approved',
      }));

      const deliveredMessages = [];

      for (const item of items) {
        // Content was already moderated once in createCheckout(), before
        // Stripe payment. This delivery runs from the payment-success path
        // (webhook) — re-checking here would double-spend quota and, if it
        // ever threw, would break delivery of an already-paid message.
        const message = await SocialChatService.sendMessage(senderId, conversation.id, {
          messageType: 'text',
          content: item.contentExtended
            ? (item.messageContent ?? '') + item.contentExtended
            : (item.messageContent ?? ''),
          isPriority: true,
          skipModeration: true,
          metadata: {
            isPriority: true,
            subject: item.subject ?? null,
            paymentId: payment.id,
            itemId: item.id,
            amountCents: payment.amountCents,
            talentProfileId: payment.talentProfileId,
            priorityAttachments: priorityAttachmentsPayload,
          },
        });

        // Link this item to the real chat message it became
        await db
          .update(priorityMessageItems)
          .set({ messageId: message.id, deliveredAt: new Date() })
          .where(eq(priorityMessageItems.id, item.id));

        deliveredMessages.push(message.id);
      }

      // Link pending attachment rows to the first delivered item
      if (items.length > 0) {
        await db
          .update(priorityMessageAttachments)
          .set({ itemId: items[0].id })
          .where(
            and(
              eq(priorityMessageAttachments.paymentId, payment.id),
              isNull(priorityMessageAttachments.itemId)
            )
          );
      }

      // Talent's net cut is held (not transferred at charge time — see
      // createCheckout) until 48h after the talent replies, per the SLA
      // escrow payout rule. talentNetCents was computed and stashed in
      // metadata at checkout-creation time.
      const reserveAmountCents = payment.metadata?.talentNetCents ?? 0;

      await db
        .update(priorityMessagePayments)
        .set({
          status: 'paid',
          stripePaymentIntent: stripeSession.payment_intent ?? null,
          conversationId: conversation.id,
          paidAt: new Date(),
          reserveAmountCents,
          updatedAt: new Date(),
        })
        .where(eq(priorityMessagePayments.id, payment.id));

      // Moderation on an attachment's file can resolve (and reject) before
      // checkout is even paid — refundRejectedAttachment defers in that case
      // since there's no stripePaymentIntent yet. Now that payment is
      // confirmed, catch up on any attachment that was already rejected.
      const rejectedAttachmentIds = paymentAttachments
        .filter(a => attachmentModerationMap.get(a.mediaId) === 'rejected')
        .map(a => a.id);
      for (const attachmentId of rejectedAttachmentIds) {
        await this.refundRejectedAttachment(attachmentId);
      }

      // Record spend — fire-and-forget
      UserSpendService.recordSpend({
        userId: payment.senderId,
        spendType: 'priority_message',
        amountCents: payment.amountCents,
        referenceId: payment.id,
        referenceType: 'priority_message_payment',
        talentUserId: payment.talentUserId,
        metadata: {
          messageCount: items.length,
          subject: items[0]?.subject ?? null,
          messages: items.map(i => i.messageContent).filter(Boolean),
        },
        stripePaymentIntentId: stripeSession.payment_intent ?? null,
        stripeSessionId: stripeSession.id,
        paidAt: new Date(),
      }).catch(err => console.error('[UserSpend] priority_message record failed:', err.message));

      // Notify talent once (not per message)
      const sender = await db.query.users.findFirst({
        where: eq(users.id, senderId),
        columns: { firstName: true, lastName: true },
      });
      const senderName = sender ? `${sender.firstName} ${sender.lastName}` : 'Someone';
      const amountDollars = (payment.baseCents / 100).toFixed(2);
      const countLabel = items.length > 1 ? ` (${items.length} messages)` : '';

      // Unlike every other createNotification() call in this file, this one
      // wasn't wrapped in .catch() — if it ever threw (e.g. a first-time
      // recipient hitting some edge case in notification settings/actor
      // resolution), it aborted this whole try block, which skipped the
      // priority:message:received socket emit just below AND fell into the
      // outer catch marking the payment 'failed' even though the message had
      // already been delivered. That's exactly the "talent never gets a
      // notification or count bump" symptom, unstuck only once something
      // else (e.g. their reply) touched the payment row again.
      await createNotification({
        userId: talentUserId,
        title: `⭐ Priority message from ${senderName}`,
        message: `${senderName} sent you a $${amountDollars} priority message${countLabel}.`,
        type: 'chat_message',
        redirectTo: `/messages?conversationId=${conversation.id}`,
        relatedId: deliveredMessages[0],
        metadata: {
          isPriority: true,
          paymentId: payment.id,
          conversationId: conversation.id,
          messageIds: deliveredMessages,
          amountCents: payment.amountCents,
          senderId,
          actorUserId: senderId,
        },
      }).catch(err => console.error('[PriorityMessage] talent notify failed:', err.message));
      const deliveredAttachments = priorityAttachmentsPayload;

      if (io && deliveredMessages.length > 0) {
        const { emitSocialChat } = await import('../socket/emitter.js');
        emitSocialChat(io, `user:${talentUserId}`, 'priority:message:received', {
          messageId: deliveredMessages[0],
          conversationId: conversation.id,
          senderId,
          amount: Math.round(payment.baseCents / 100),
          amountCents: payment.baseCents,
          subject: items[0]?.subject ?? null,
          messageContent: items[0]?.messageContent ?? null,
          paidAt: new Date().toISOString(),
          talentProfileId: payment.talentProfileId ?? null,
          attachments: deliveredAttachments,
        });
      }
    } catch (err) {
      console.error('[fPriorityMessage] Webhook delivery failed:', err.message);
      await db
        .update(priorityMessagePayments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(priorityMessagePayments.id, payment.id));
    }
  }

  // ── Poll payment status ───────────────────────────────────────────────────

  /**
   * GET /priority-messages/:paymentId/status
   * Called by the frontend after Stripe redirect to check if message was delivered.
   */
  static async getStatus(paymentId, requesterId) {
    const payment = await db.query.priorityMessagePayments.findFirst({
      where: eq(priorityMessagePayments.id, paymentId),
    });
    if (!payment) throw new ApiError(404, 'Payment not found');
    if (payment.senderId !== requesterId) throw new ApiError(403, 'Forbidden');

    const items = await db.query.priorityMessageItems.findMany({
      where: eq(priorityMessageItems.paymentId, payment.id),
      orderBy: (i, { asc }) => [asc(i.position)],
      columns: { messageId: true },
    });

    return {
      status: payment.status,
      conversationId: payment.conversationId,
      messageIds: items.map(i => i.messageId).filter(Boolean),
      paidAt: payment.paidAt,
      amountCents: payment.amountCents,
      talentProfileId: payment.talentProfileId,
    };
  }

  // ── Earnings summary for the talent dashboard ─────────────────────────────

  /**
   * Returns aggregate priority message earnings for a talent user.
   * Used by getDashboardStats controller.
   *
   * @param {string} talentUserId
   * @returns {{
   *   totalEarningsCents, totalEarnings,
   *   totalMessages, unreadCount, responseRate,
   *   monthlyEarnings: [{ month, earnings, earningsCents }]
   * }}
   */
  static async getEarningsSummary(talentUserId) {
    // ── 4. Priority message earnings (parallel, non-blocking) ────────────────
    const msgSummary = await PriorityMessageService.getEarningsSummary(req.user.id).catch(() => ({
      totalEarnings: 0,
      totalEarningsCents: 0,
      totalMessages: 0,
      unreadCount: 0,
      responseRate: 0,
      activeConversations: 0,
      todayCount: 0,
      weekCount: 0,
      monthlyEarnings: Array(7).fill({ earnings: 0, earningsCents: 0 }),
    }));

    // ── 5. Monthly earnings — last 7 calendar months ─────────────────────────
    const now = new Date();
    const MONTH_ABBR = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const months = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_ABBR[d.getMonth()] });
    }

    const monthlyEarnings = months.map(({ year, month, label }, idx) => {
      const videoEarningsCents = completed
        .filter(s => {
          const d = new Date(s.scheduledAt);
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((sum, s) => sum + (s.priceCents || 0), 0);

      return {
        month: label,
        videoEarnings: Math.round(videoEarningsCents / 100),
        messageEarnings: msgSummary.monthlyEarnings[idx]?.earnings ?? 0,
      };
    });

    // ── 6. Recent sessions (last 10) ─────────────────────────────────────────
    const recentSessions = allSessions.slice(0, 10).map(s => ({
      id: s.id,
      requesterName: s.booker ? `${s.booker.firstName} ${s.booker.lastName}` : 'Unknown',
      requesterAvatar: s.booker?.profileImage || null,
      date: s.scheduledAt,
      duration: s.durationMins,
      price: Math.round((s.priceCents || 0) / 100),
      subject: s.subject || '',
      status: s.status,
    }));

    // ── 7. Respond ────────────────────────────────────────────────────────────
    res.json({
      success: true,
      data: {
        profile: {
          rating: profile.rating,
          totalSessions: profile.totalSessions,
          priorityMessageFee: Math.round((profile.priorityMessageFee || 0) / 100),
          rates: profile.rates,
          isActive: profile.isActive,
        },
        stats: {
          // Video stats (unchanged)
          totalEarningsCents,
          totalEarnings: Math.round(totalEarningsCents / 100),
          completedSessions,
          totalMinutes,
          totalRequests,
          acceptedRequests,
          acceptanceRate,
          cancelledCount,
          cancellationRate,
          // Priority message stats (NEW)
          totalMessageEarnings: msgSummary.totalEarnings,
          totalPriorityMessages: msgSummary.totalMessages,
          unreadPriorityMessages: msgSummary.unreadCount,
          messageResponseRate: msgSummary.responseRate,
          activeConversations: msgSummary.activeConversations,
          messagesToday: msgSummary.todayCount,
          messagesThisWeek: msgSummary.weekCount,
        },
        monthlyEarnings,
        recentSessions,
      },
    });
  }

  // ── Received messages list for the Priority Messages tab ──────────────────

  /**
   * GET /priority-messages/received
   * Paginated list of paid priority messages received by the talent.
   *
   * @param {string} talentUserId
   * @param {{ page, limit }} opts
   */
  static async getReceivedMessages(talentUserId, { page = 1, limit = 20 } = {}) {
    limit = Math.min(Number(limit) || 20, 50);
    page = Math.max(Number(page) || 1, 1);
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        itemId: priorityMessageItems.id,
        subject: priorityMessageItems.subject,
        messageContent: priorityMessageItems.messageContent,
        messageId: priorityMessageItems.messageId,
        repliedAt: priorityMessageItems.repliedAt,
        itemStatus: priorityMessageItems.status,
        replyCount: priorityMessageItems.replyCount,
        paymentId: priorityMessagePayments.id,
        baseCents: priorityMessagePayments.baseCents,
        messageCount: priorityMessagePayments.messageCount,
        paidAt: priorityMessagePayments.paidAt,
        conversationId: priorityMessagePayments.conversationId,
        senderId: priorityMessagePayments.senderId,
      })
      .from(priorityMessageItems)
      .innerJoin(
        priorityMessagePayments,
        eq(priorityMessageItems.paymentId, priorityMessagePayments.id)
      )
      .where(
        and(
          eq(priorityMessagePayments.talentUserId, talentUserId),
          inArray(priorityMessagePayments.status, [
            'paid',
            'partial',
            'replied',
            'refunded',
            'partial_refunded',
          ])
        )
      )
      .orderBy(sql`${priorityMessagePayments.paidAt} DESC`, priorityMessageItems.position)
      .limit(limit)
      .offset(offset);

    const senderIds = [...new Set(rows.map(r => r.senderId).filter(Boolean))];
    const senders = senderIds.length
      ? await db.query.users.findMany({
          where: inArray(users.id, senderIds),
          columns: { id: true, firstName: true, lastName: true, username: true, image: true },
        })
      : [];
    const senderMap = new Map(senders.map(s => [s.id, s]));

    const messageIds = rows.map(r => r.messageId).filter(Boolean);
    const seenMap = new Map();
    if (messageIds.length > 0) {
      const seenRows = await db.query.socialMessages.findMany({
        where: inArray(socialMessages.id, messageIds),
        columns: { id: true, isSeen: true },
      });
      for (const m of seenRows) seenMap.set(m.id, m.isSeen);
    }

    // Per-payment replied item count
    const paymentIds = [...new Set(rows.map(r => r.paymentId).filter(Boolean))];
    const repliedCountMap = new Map();
    if (paymentIds.length > 0) {
      const repliedCounts = await db
        .select({
          paymentId: priorityMessageItems.paymentId,
          repliedCount: sql`count(*)::int`,
        })
        .from(priorityMessageItems)
        .where(
          and(
            inArray(priorityMessageItems.paymentId, paymentIds),
            sql`${priorityMessageItems.repliedAt} IS NOT NULL`
          )
        )
        .groupBy(priorityMessageItems.paymentId);
      for (const r of repliedCounts) repliedCountMap.set(r.paymentId, r.repliedCount);
    }

    const attachmentsByPayment = new Map();
    if (paymentIds.length > 0) {
      const attachmentRows = await db.query.priorityMessageAttachments.findMany({
        where: inArray(priorityMessageAttachments.paymentId, paymentIds),
        columns: {
          id: true,
          paymentId: true,
          url: true,
          originalName: true,
          mimetype: true,
          sizeBytes: true,
          status: true,
          viewedAt: true,
          mediaId: true,
        },
      });
      const attachmentModerationMap = await MediaModerationService.statusesByMediaIds(
        attachmentRows.map(a => a.mediaId)
      );
      for (const a of attachmentRows) {
        const moderationStatus = attachmentModerationMap.get(a.mediaId) ?? 'approved';
        // A refund not caused by moderation (e.g. 72h no-reply) stays hidden,
        // same as before. A moderation-rejected one stays visible so the
        // inbox can show a "removed for violating guidelines" placeholder.
        if (a.status === 'refunded' && moderationStatus !== 'rejected') continue;
        if (!attachmentsByPayment.has(a.paymentId)) attachmentsByPayment.set(a.paymentId, []);
        attachmentsByPayment.get(a.paymentId).push({
          id: a.id,
          url: a.url,
          originalName: a.originalName,
          mimetype: a.mimetype,
          sizeBytes: a.sizeBytes,
          status: a.status,
          viewedAt: a.viewedAt ?? null,
          moderationStatus,
        });
      }
    }

    const enriched = rows.map(row => ({
      id: row.itemId,
      paymentId: row.paymentId,
      amountCents: Math.round(
        (row.baseCents - Math.round(row.baseCents * 0.05)) / (row.messageCount || 1)
      ),
      amount: Math.round(
        (row.baseCents - Math.round(row.baseCents * 0.05)) / (row.messageCount || 1) / 100
      ),
      totalCount: row.messageCount,
      repliedCount: repliedCountMap.get(row.paymentId) ?? 0,
      subject: row.subject,
      messageContent: row.messageContent,
      paidAt: row.paidAt,
      conversationId: row.conversationId,
      messageId: row.messageId,
      isSeen: row.messageId ? (seenMap.get(row.messageId) ?? true) : true,
      hasReplied: !!row.repliedAt,
      status: row.itemStatus,
      replyCount: row.replyCount,
      sender: senderMap.get(row.senderId) ?? null,
      attachments: attachmentsByPayment.get(row.paymentId) ?? [],
    }));

    const [{ total }] = await db
      .select({ total: sql`count(*)::int` })
      .from(priorityMessageItems)
      .innerJoin(
        priorityMessagePayments,
        eq(priorityMessageItems.paymentId, priorityMessagePayments.id)
      )
      .where(
        and(
          eq(priorityMessagePayments.talentUserId, talentUserId),
          inArray(priorityMessagePayments.status, [
            'paid',
            'partial',
            'replied',
            'refunded',
            'partial_refunded',
          ])
        )
      );

    const receivedFilterEnabled = await TextModerationService.getFilterEnabled(talentUserId);
    await TextModerationService.maskFlaggedText(enriched, {
      entityType: TEXT_ENTITY.MESSAGE,
      fields: ['subject', 'messageContent'],
      filterEnabled: receivedFilterEnabled,
    });

    return {
      messages: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    };
  }

  static async getPriorityConversations(
    talentUserId,
    { page = 1, limit = 20, onlyOutstanding = false } = {}
  ) {
    limit = Math.min(Number(limit) || 20, 50);
    page = Math.max(Number(page) || 1, 1);
    const offset = (page - 1) * limit;

    // One row per conversation, picking the most recent payment in it.
    // DISTINCT ON requires the ORDER BY to start with the same expression.
    const conversationPayments = await db
      .select({
        conversationId: priorityMessagePayments.conversationId,
        paymentId: priorityMessagePayments.id,
        baseCents: priorityMessagePayments.baseCents,
        messageCount: priorityMessagePayments.messageCount,
        status: priorityMessagePayments.status,
        paidAt: priorityMessagePayments.paidAt,
        senderId: priorityMessagePayments.senderId,
      })
      .from(priorityMessagePayments)
      .where(
        and(
          eq(priorityMessagePayments.talentUserId, talentUserId),
          inArray(priorityMessagePayments.status, onlyOutstanding ? ['paid'] : ['paid', 'replied']),
          sql`${priorityMessagePayments.conversationId} IS NOT NULL`
        )
      )
      .orderBy(priorityMessagePayments.conversationId, sql`${priorityMessagePayments.paidAt} DESC`);

    // Collapse to most-recent-per-conversation in JS (portable across PG
    // versions without relying on DISTINCT ON ordering quirks).
    const latestByConversation = new Map();
    for (const row of conversationPayments) {
      if (!latestByConversation.has(row.conversationId)) {
        latestByConversation.set(row.conversationId, row);
      }
    }

    const allRows = [...latestByConversation.values()].sort(
      (a, b) => new Date(b.paidAt) - new Date(a.paidAt)
    );
    const pageRows = allRows.slice(offset, offset + limit);
    const conversationIds = pageRows.map(r => r.conversationId);

    if (conversationIds.length === 0) {
      return { conversations: [], page, limit, hasMore: false, total: allRows.length };
    }

    // Fetch conversations + other participant + last message preview + unread count
    const conversations = await db.query.socialConversations.findMany({
      where: inArray(socialConversations.id, conversationIds),
    });
    const convoMap = new Map(conversations.map(c => [c.id, c]));

    const senderIds = [...new Set(pageRows.map(r => r.senderId))];
    const senders = senderIds.length
      ? await db.query.users.findMany({
          where: inArray(users.id, senderIds),
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            image: true,
            lastSeen: true,
            showOnlineStatus: true,
          },
        })
      : [];
    const senderMap = new Map(senders.map(s => [s.id, s]));

    const { latestMap: lastMsgMap, unreadCountMap } =
      await SocialChatService.getLatestInboundMessages(talentUserId, conversationIds);

    const conversationsFilterEnabled = await TextModerationService.getFilterEnabled(talentUserId);
    await TextModerationService.maskFlaggedText([...lastMsgMap.values()], {
      entityType: TEXT_ENTITY.MESSAGE,
      fields: ['content'],
      filterEnabled: conversationsFilterEnabled,
    });

    const result = pageRows.map(row => {
      const convo = convoMap.get(row.conversationId);
      const sender = senderMap.get(row.senderId);
      const lastMsg = lastMsgMap.get(row.conversationId) || null;

      return {
        conversationId: row.conversationId,
        otherUser: sender
          ? {
              id: sender.id,
              firstName: sender.firstName,
              lastName: sender.lastName,
              username: sender.username,
              image: sender.image,
              isOnline: sender.showOnlineStatus
                ? Date.now() - new Date(sender.lastSeen).getTime() < 5 * 60 * 1000
                : null,
            }
          : null,
        lastMessage: lastMsg ? { content: lastMsg.content, createdAt: lastMsg.createdAt } : null,
        unreadCount: unreadCountMap.get(row.conversationId) ?? 0,
        priority: {
          paymentId: row.paymentId,
          amountCents: (row.baseCents || 0) - Math.round((row.baseCents || 0) * 0.05),
          amount: Math.round(
            ((row.baseCents || 0) - Math.round((row.baseCents || 0) * 0.05)) / 100
          ),
          messageCount: row.messageCount,
          status: row.status, // 'paid' = awaiting reply, 'replied' = released
          awaitingReply: row.status === 'paid',
        },
        // For sort stability on the frontend if it re-sorts client-side
        updatedAt: convo?.updatedAt ?? row.paidAt,
      };
    });

    return {
      conversations: result,
      page,
      limit,
      total: allRows.length,
      hasMore: offset + pageRows.length < allRows.length,
    };
  }

  // ── Priority tab: banner for an open conversation ──────────────────────────

  /**
   * GET /priority-messages/conversations/:conversationId/banner
   *
   * Returns the outstanding (unreplied) priority payment for THIS conversation
   * (if any) plus the talent's lifetime total earned. Banner only renders on
   * the frontend when `outstanding` is non-null.
   *
   * @param {string} talentUserId
   * @param {string} conversationId
   */
  static async getConversationBanner(talentUserId, conversationId) {
    // Verify the talent is actually a participant — reuse the same check
    // SocialChatService uses, so this throws a consistent 403/404.
    await SocialChatService.getConversation(talentUserId, conversationId);

    const outstanding = await db.query.priorityMessagePayments.findFirst({
      where: and(
        eq(priorityMessagePayments.conversationId, conversationId),
        eq(priorityMessagePayments.talentUserId, talentUserId),
        eq(priorityMessagePayments.status, 'paid')
      ),
      orderBy: (p, { desc }) => [desc(p.paidAt)],
      columns: { id: true, baseCents: true, messageCount: true, paidAt: true },
    });

    const totalEarnedRow = await db
      .select({
        total: sql`COALESCE(SUM(${priorityMessagePayments.baseCents} - ROUND(${priorityMessagePayments.baseCents}::numeric * 0.05)::int), 0)::int`,
      })
      .from(priorityMessagePayments)
      .where(
        and(
          eq(priorityMessagePayments.talentUserId, talentUserId),
          inArray(priorityMessagePayments.status, ['paid', 'replied', 'partial_refunded'])
        )
      );

    const totalEarnedCents = totalEarnedRow[0]?.total ?? 0;

    return {
      outstanding: outstanding
        ? {
            paymentId: outstanding.id,
            amountCents: outstanding.baseCents - Math.round(outstanding.baseCents * 0.05),
            amount: Math.round(
              (outstanding.baseCents - Math.round(outstanding.baseCents * 0.05)) / 100
            ),
            messageCount: outstanding.messageCount,
            paidAt: outstanding.paidAt,
          }
        : null,
      totalEarnedCents,
      totalEarned: Math.round(totalEarnedCents / 100),
    };
  }

  // ── Release payment immediately when talent replies ────────────────────────

  /**
   * Call this from SocialChatService.sendMessage() (or the controller right
   * after it) whenever the SENDER of the new message is a talent who has
   * outstanding priority payments in that conversation. Marks them 'replied'
   * immediately rather than waiting for the 72h cron — matches the UI's
   * "Reply to release $X payment" promise.
   *
   * Safe to call on every message send; it's a no-op if there's nothing
   * outstanding in that conversation.
   *
   * @param {string} conversationId
   * @param {string} talentUserId
   */
  // ── releaseOnReply — per-item tracking, not per-payment ───────────────────
  static async releaseOnReply(
    conversationId,
    talentUserId,
    replyToMessageId = null,
    newMessageId = null
  ) {
    const outstanding = await db.query.priorityMessagePayments.findMany({
      where: and(
        eq(priorityMessagePayments.conversationId, conversationId),
        eq(priorityMessagePayments.talentUserId, talentUserId),
        inArray(priorityMessagePayments.status, ['paid', 'partial'])
      ),
      columns: { id: true, messageCount: true },
    });

    if (outstanding.length === 0) return { released: 0 };

    const paymentIds = outstanding.map(p => p.id);

    // Find the item to update — no repliedAt filter so replyCount always increments
    let itemToRelease = null;

    if (replyToMessageId) {
      itemToRelease = await db.query.priorityMessageItems.findFirst({
        where: and(
          inArray(priorityMessageItems.paymentId, paymentIds),
          eq(priorityMessageItems.messageId, replyToMessageId)
        ),
        columns: { id: true, paymentId: true, repliedAt: true, deliveredAt: true },
      });
    }

    if (!itemToRelease) {
      // Fallback: first delivered item by position, preferring one that's
      // still within the reply window over one that's already expired —
      // a plain (non-quoted) reply should land on something it can still
      // earn for, when there's a choice.
      const candidates = await db.query.priorityMessageItems.findMany({
        where: and(
          inArray(priorityMessageItems.paymentId, paymentIds),
          sql`${priorityMessageItems.messageId} IS NOT NULL`
        ),
        orderBy: (i, { asc }) => [asc(i.position)],
        columns: { id: true, paymentId: true, repliedAt: true, deliveredAt: true },
      });
      itemToRelease =
        candidates.find(
          i => !i.repliedAt && (!i.deliveredAt || Date.now() - i.deliveredAt.getTime() <= REPLY_WINDOW_MS)
        ) ?? candidates[0] ?? null;
    }

    if (!itemToRelease) return { released: 0 };

    const wasAlreadyReplied = !!itemToRelease.repliedAt;

    if (wasAlreadyReplied) {
      // Already settled (replied or expired) — just record that the talent
      // sent another follow-up, nothing to release or close out again.
      await db
        .update(priorityMessageItems)
        .set({
          replyCount: sql`${priorityMessageItems.replyCount} + 1`,
          replyMessageId: newMessageId ?? null,
        })
        .where(eq(priorityMessageItems.id, itemToRelease.id));
      return { released: 0, replyCountIncremented: true };
    }

    const isExpired =
      !!itemToRelease.deliveredAt &&
      Date.now() - itemToRelease.deliveredAt.getTime() > REPLY_WINDOW_MS;

    if (isExpired) {
      // Past the 72h SLA — this reply is too late to earn. Label it
      // 'expired' but deliberately leave repliedAt null: the outstanding-
      // payments query above and processExpiredRefunds' cron both key off
      // repliedAt IS NULL to find items still owed a refund, so this keeps
      // the sender's refund flowing through that existing path untouched.
      await db
        .update(priorityMessageItems)
        .set({
          replyCount: sql`${priorityMessageItems.replyCount} + 1`,
          replyMessageId: newMessageId ?? null,
          status: 'expired',
        })
        .where(eq(priorityMessageItems.id, itemToRelease.id));
      return { released: 0, expired: true };
    }

    // Always increment replyCount; set repliedAt + status only on first reply
    await db
      .update(priorityMessageItems)
      .set({
        replyCount: sql`${priorityMessageItems.replyCount} + 1`,
        replyMessageId: newMessageId ?? null,
        repliedAt: new Date(),
        status: 'replied',
      })
      .where(eq(priorityMessageItems.id, itemToRelease.id));

    // Check if ALL items in this payment are now replied
    const remainingUnreplied = await db.query.priorityMessageItems.findMany({
      where: and(
        eq(priorityMessageItems.paymentId, itemToRelease.paymentId),
        sql`${priorityMessageItems.repliedAt} IS NULL`,
        sql`${priorityMessageItems.messageId} IS NOT NULL`
      ),
      columns: { id: true },
    });

    if (remainingUnreplied.length === 0) {
      // All items replied → mark payment as fully replied
      await db
        .update(priorityMessagePayments)
        .set({ status: 'replied', repliedAt: new Date(), updatedAt: new Date() })
        .where(eq(priorityMessagePayments.id, itemToRelease.paymentId));

      return { released: 1, paymentFullyReplied: true, paymentId: itemToRelease.paymentId };
    } else {
      // Partially replied → mark payment as partial
      await db
        .update(priorityMessagePayments)
        .set({ status: 'partial', updatedAt: new Date() })
        .where(eq(priorityMessagePayments.id, itemToRelease.paymentId));

      return {
        released: 1,
        paymentFullyReplied: false,
        remainingItems: remainingUnreplied.length,
      };
    }
  }

  static async processExpiredRefunds() {
    if (!stripe) return;

    const cutoff = new Date(Date.now() - REPLY_WINDOW_MS);

    const expired = await db.query.priorityMessagePayments.findMany({
      where: and(
        inArray(priorityMessagePayments.status, ['paid', 'partial']),
        sql`${priorityMessagePayments.paidAt} < ${cutoff}`
      ),
      with: {
        sender: { columns: { id: true, email: true, firstName: true, lastName: true } },
        items: { columns: { id: true, repliedAt: true, deliveredAt: true } },
      },
    });

    for (const payment of expired) {
      try {
        const deliveredItems = payment.items.filter(i => i.deliveredAt);
        const unrepliedItems = deliveredItems.filter(i => !i.repliedAt);

        // All replied — just close it cleanly, no refund needed
        if (unrepliedItems.length === 0) {
          await db
            .update(priorityMessagePayments)
            .set({ status: 'replied', updatedAt: new Date() })
            .where(eq(priorityMessagePayments.id, payment.id));
          continue;
        }

        const totalItems = deliveredItems.length;
        const repliedItems = totalItems - unrepliedItems.length;
        const refundRatio = unrepliedItems.length / totalItems;
        const refundCents = Math.round(payment.amountCents * refundRatio);

        // Only update DB if Stripe refund actually succeeds (or no payment intent)
        if (payment.stripePaymentIntent) {
          await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntent,
            amount: refundCents,
            reason: 'requested_by_customer',
            metadata: {
              reason: '72h_no_response',
              paymentId: payment.id,
              unrepliedItems: unrepliedItems.length,
              totalItems,
            },
          });
        } else {
          // No payment intent — log and skip, don't mark refunded
          console.warn(
            `[PriorityMessage] No stripePaymentIntent for ${payment.id} — skipping refund`
          );
          continue;
        }

        // Use 'partial_refunded' when some items WERE replied to (talent keeps earnings)
        // Use 'refunded' only when nothing was replied to at all
        const newStatus = repliedItems > 0 ? 'partial_refunded' : 'refunded';

        await db
          .update(priorityMessagePayments)
          .set({
            status: newStatus,
            refundedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(priorityMessagePayments.id, payment.id));

        // Mark unreplied items as closed — 'expired' (not 'replied', not
        // eligible for a late reply to earn) now that the refund has issued.
        await db
          .update(priorityMessageItems)
          .set({ repliedAt: new Date(), status: 'expired' })
          .where(
            inArray(
              priorityMessageItems.id,
              unrepliedItems.map(i => i.id)
            )
          );

        const refundDollars = (refundCents / 100).toFixed(2);
        const isFullRefund = repliedItems === 0;

        await createNotification({
          userId: payment.senderId,
          title: isFullRefund
            ? '💸 Priority message refunded'
            : '💸 Priority message partially refunded',
          message: isFullRefund
            ? `Your priority message wasn't answered within 72 hours. A $${refundDollars} refund has been issued.`
            : `${unrepliedItems.length} of ${totalItems} priority messages weren't answered within 72 hours. A $${refundDollars} refund has been issued.`,
          type: 'payment',
          metadata: {
            paymentId: payment.id,
            reason: isFullRefund ? '72h_no_response' : '72h_partial_no_response',
            unrepliedItems: unrepliedItems.length,
            totalItems,
            refundCents,
          },
        });

        // Refund all attachments (viewed or not) if talent never replied within 72h
        const refundableAttachments = await db.query.priorityMessageAttachments.findMany({
          where: and(
            eq(priorityMessageAttachments.paymentId, payment.id),
            ne(priorityMessageAttachments.status, 'refunded')
          ),
          columns: { id: true, priceCents: true },
        });

        if (refundableAttachments.length > 0 && payment.stripePaymentIntent) {
          const attachmentRefundCents = refundableAttachments.reduce(
            (sum, a) => sum + a.priceCents,
            0
          );

          await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntent,
            amount: attachmentRefundCents,
            reason: 'requested_by_customer',
            metadata: {
              reason: '48h_no_reply_attachment_refund',
              paymentId: payment.id,
              attachmentCount: String(refundableAttachments.length),
            },
          });

          await db
            .update(priorityMessageAttachments)
            .set({ status: 'refunded', refundedAt: new Date() })
            .where(
              inArray(
                priorityMessageAttachments.id,
                refundableAttachments.map(a => a.id)
              )
            );
        }
      } catch (err) {
        console.error(`[PriorityMessage] Refund failed for ${payment.id}:`, err.message);
      }
    }
  }

  /**
   * Moderation rejected the underlying file — refund that one attachment's
   * fee and notify both the sender (who paid) and the talent (who lost
   * access to it). Called from MediaModerationService.propagateMediaVerdict
   * when a file backing a priority message attachment gets rejected.
   */
  static async refundRejectedAttachment(attachmentId) {
    const attachment = await db.query.priorityMessageAttachments.findFirst({
      where: eq(priorityMessageAttachments.id, attachmentId),
      with: {
        payment: {
          columns: { id: true, senderId: true, talentUserId: true, stripePaymentIntent: true },
        },
      },
    });
    if (!attachment || attachment.status === 'refunded') return;

    const payment = attachment.payment;
    if (!stripe || !payment?.stripePaymentIntent) {
      // Moderation can reject the file before checkout is even paid (the
      // attachment row exists from checkout-creation, well before Stripe
      // confirms payment). Nothing to refund yet — handleWebhook re-checks
      // for already-rejected attachments once stripePaymentIntent lands.
      console.warn(
        `[PriorityMessage] Attachment ${attachmentId} rejected but payment not yet confirmed — refund deferred`
      );
      return;
    }

    try {
      await stripe.refunds.create({
        payment_intent: payment.stripePaymentIntent,
        amount: attachment.priceCents,
        reason: 'requested_by_customer',
        metadata: {
          reason: 'moderation_rejected_attachment',
          paymentId: payment.id,
          attachmentId: attachment.id,
        },
      });

      await db
        .update(priorityMessageAttachments)
        .set({ status: 'refunded', refundedAt: new Date() })
        .where(eq(priorityMessageAttachments.id, attachment.id));

      const refundDollars = (attachment.priceCents / 100).toFixed(2);
      if (payment?.senderId) {
        await createNotification({
          userId: payment.senderId,
          title: '💸 Attachment removed — refunded',
          message: `An attachment you sent was removed for violating our community guidelines. A $${refundDollars} refund has been issued.`,
          type: 'payment',
          metadata: {
            paymentId: payment.id,
            attachmentId: attachment.id,
            reason: 'moderation_rejected_attachment',
          },
        });
      }
      if (payment?.talentUserId) {
        await createNotification({
          userId: payment.talentUserId,
          title: 'An attachment was removed',
          message:
            'An attachment sent to you was removed for violating our community guidelines and is no longer available.',
          type: 'payment',
          metadata: {
            paymentId: payment.id,
            attachmentId: attachment.id,
            reason: 'moderation_rejected_attachment',
          },
        });
      }
    } catch (err) {
      console.error(
        `[PriorityMessage] Rejected-attachment refund failed for ${attachmentId}:`,
        err.message
      );
    }
  }

  static async markAttachmentViewed(attachmentId, talentUserId) {
    const attachment = await db.query.priorityMessageAttachments.findFirst({
      where: eq(priorityMessageAttachments.id, attachmentId),
      with: {
        payment: { columns: { talentUserId: true, status: true } },
      },
    });

    if (!attachment) throw new ApiError(404, 'Attachment not found');
    if (attachment.payment.talentUserId !== talentUserId) throw new ApiError(403, 'Forbidden');
    if (attachment.status === 'refunded') throw new ApiError(410, 'Attachment has been refunded');
    if (attachment.status === 'viewed') return { alreadyViewed: true };

    await db
      .update(priorityMessageAttachments)
      .set({ status: 'viewed', viewedAt: new Date() })
      .where(eq(priorityMessageAttachments.id, attachmentId));

    return { viewed: true };
  }

  static async getConversationSpend(senderId, conversationId) {
    await SocialChatService.getConversation(senderId, conversationId);
    // Same status list as getTotalSpent() — every payment that actually took
    // money and wasn't fully refunded, not just the currently-outstanding
    // ('paid'/'partial') ones. Otherwise this reads $0 the moment the talent
    // replies and the payment resolves to 'replied', even though the sender
    // clearly did spend money in this conversation.
    const totalSpentRow = await db
      .select({ total: sql`COALESCE(SUM(${priorityMessagePayments.amountCents}), 0)::int` })
      .from(priorityMessagePayments)
      .where(
        and(
          eq(priorityMessagePayments.senderId, senderId),
          eq(priorityMessagePayments.conversationId, conversationId),
          inArray(priorityMessagePayments.status, ['paid', 'partial', 'replied', 'partial_refunded'])
        )
      );

    const totalSpentCents = totalSpentRow[0]?.total ?? 0;

    return {
      totalSpentCents,
      totalSpent: totalSpentCents / 100,
    };
  }

  static async getTalentProfileForConversation(senderId, conversationId) {
    await SocialChatService.getConversation(senderId, conversationId);

    const payment = await db.query.priorityMessagePayments.findFirst({
      where: and(
        eq(priorityMessagePayments.conversationId, conversationId),
        eq(priorityMessagePayments.senderId, senderId)
      ),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
      columns: { talentProfileId: true },
    });

    return { talentProfileId: payment?.talentProfileId ?? null };
  }

  static async getTotalEarned(talentUserId, { senderId } = {}) {
    const conditions = [
      eq(priorityMessagePayments.talentUserId, talentUserId),
      eq(priorityMessagePayments.status, 'replied'),
    ];
    if (senderId) {
      conditions.push(eq(priorityMessagePayments.senderId, senderId));
    }

    const [result] = await db
      .select({
        totalEarnedCents: sql`COALESCE(SUM(${priorityMessagePayments.baseCents} - ROUND(${priorityMessagePayments.baseCents}::numeric * 0.05)::int), 0)::int`,
      })
      .from(priorityMessagePayments)
      .where(and(...conditions));

    const totalEarnedCents = Number(result.totalEarnedCents);
    return {
      totalEarnedCents,
      totalEarned: Math.round(totalEarnedCents / 100),
    };
  }

  static async getTotalSpent(senderId) {
    const totalSpentRow = await db
      .select({ total: sql`COALESCE(SUM(${priorityMessagePayments.amountCents}), 0)::int` })
      .from(priorityMessagePayments)
      .where(
        and(
          eq(priorityMessagePayments.senderId, senderId),
          inArray(priorityMessagePayments.status, [
            'paid',
            'partial',
            'replied',
            'partial_refunded',
          ])
        )
      );

    const totalSpentCents = totalSpentRow[0]?.total ?? 0;

    return {
      totalSpentCents,
      totalSpent: Math.round(totalSpentCents / 100),
    };
  }
   static async getItemStatuses(requesterId, conversationId) {
  // Same participant check used by getConversationBanner/getConversationSpend —
  // works whether requester is the sender or the talent.
  await SocialChatService.getConversation(requesterId, conversationId);

  const rows = await db
    .select({
      messageId: priorityMessageItems.messageId,
      status: priorityMessageItems.status,
    })
    .from(priorityMessageItems)
    .innerJoin(
      priorityMessagePayments,
      eq(priorityMessageItems.paymentId, priorityMessagePayments.id)
    )
    .where(
      and(
        eq(priorityMessagePayments.conversationId, conversationId),
        sql`${priorityMessageItems.messageId} IS NOT NULL`
      )
    );

  const statusMap = {};
  for (const row of rows) {
    statusMap[row.messageId] = row.status;
  }
  return statusMap;
}

  /**
   * True if this sender already has a paid message to this talent still
   * awaiting reply (or partially replied, with items still outstanding).
   * Shared by createCheckout()'s own guard and the proactive frontend check
   * (GET /priority-messages/pending/:talentProfileId) so a talent-profile
   * "Send Message" click can warn the sender before they fill out the whole
   * form, instead of only failing at the very end.
   */
  static async hasPendingMessage(senderId, talentProfileId) {
    const pendingPayment = await db.query.priorityMessagePayments.findFirst({
      where: and(
        eq(priorityMessagePayments.senderId, senderId),
        eq(priorityMessagePayments.talentProfileId, talentProfileId),
        inArray(priorityMessagePayments.status, ['paid', 'partial'])
      ),
      columns: { id: true },
    });
    return !!pendingPayment;
  }
}