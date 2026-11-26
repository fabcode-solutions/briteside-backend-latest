/**
 * Business inbox — customer ↔ business conversations (db/schema/businessInbox.js).
 *
 * A business profile is its own account: the business side of a thread is the
 * business, answered by the owner and team members with 'inbox.manage'
 * (owner / admin / manager). Nothing here touches social_conversations, so
 * none of it appears in the owner's personal Messages, and replies reach the
 * customer from the business — never from the owner's personal profile.
 *
 * Same safety rules as page inquiries had in personal chat: text is moderated
 * and contact details are hidden in both directions until the customer books
 * the business on Briteside (InquiryContactService).
 */
import httpStatus from 'http-status';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  businessBookings,
  businessConversations,
  businessCustomOffers,
  businessMessages,
  businesses,
  businessServices,
  businessTeamMembers,
  users,
} from '../db/schema/index.js';
import { priorityMessageItems } from '../db/schema/priorityMessagePayments.js';
import ApiError from '../utils/api-error.js';
import {
  KINDS,
  applyMediaVerdict,
  normalizeMessage,
  otherSide,
  replyPreview,
  teamPreview,
} from '../utils/businessInbox.js';
import { emitSocialChat } from '../socket/emitter.js';
import { notifications } from '../db/schema/notifications.js';
import { createNotification } from './notification.service.js';

const REPLY_NOTIFICATION_TYPE = 'chat_message';
// To the business team — shown by the apps only while acting as the business
const TEAM_NOTIFICATION_TYPE = 'business_message';
// Replies within this window update the unread notification instead of pushing again
const REPLY_NOTIFICATION_QUIET_MS = 10 * 60 * 1000;
import { BUSINESS_PERMISSIONS, permissionsForMember } from '../config/business-permissions.js';
import { resolveBusinessAccess } from '../middlewares/businessAccess.middleware.js';
import { loadPublicBusiness } from './businessWall.service.js';
import { BlockService } from './social/block.service.js';
import { InquiryContactService } from './inquiryContact.service.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';
import FileManagementService from './fileManagement.service.js';
import { MediaModerationService, HELD_FROM_OTHERS } from './moderation/mediaModeration.service.js';
import { media, mediaOwners } from '../db/schema/fileTracking.js';
import { queueBusinessInboxInquiryEmail } from './businessInquiryEmail.service.js';

const CUSTOMER_COLUMNS = { id: true, firstName: true, lastName: true, username: true, image: true };
const BUSINESS_COLUMNS = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  ownerId: true,
  email: true,
  inquiryChannel: true,
  inquiryEmail: true,
  deletedAt: true,
};

// Same window as PriorityMessageService's REPLY_WINDOW_MS (talent's 72h to reply)
const PRIORITY_REPLY_WINDOW_MS = 72 * 60 * 60 * 1000;

const MAX_PAGE = 100;
const clampLimit = (limit, fallback) => Math.min(Math.max(Number(limit) || fallback, 1), MAX_PAGE);

/** What the customer sees: the business, never which team member wrote it. */
const customerView = m => ({
  id: m.id,
  conversationId: m.conversationId,
  senderSide: m.senderSide,
  messageType: m.messageType,
  content: m.content,
  metadata: m.metadata ?? {},
  createdAt: m.createdAt,
});

/** What the team sees: also who on the team sent each business message. */
const businessView = (m, senderUsers = new Map()) => ({
  ...customerView(m),
  senderUser: m.senderSide === 'business' ? (senderUsers.get(m.senderUserId) ?? null) : null,
});

const publicBusiness = b => ({ id: b.id, name: b.name, slug: b.slug, logoUrl: b.logoUrl ?? null });

export class BusinessInboxService {
  // ─── Opening a thread ──────────────────────────────────────────────────────

  /**
   * Customer: their thread with a business — "Send inquiry" / "Inquire" →
   * the Inquiries inbox, "Message" → General. (Paid threads are only ever
   * started by the business paying for a priority message.)
   */
  static async openForCustomer(user, idOrSlug, kind = 'inquiry') {
    if (kind !== 'inquiry' && kind !== 'general') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown inbox');
    }
    const business = await loadPublicBusiness(idOrSlug);
    const access = await resolveBusinessAccess(business, user);
    if (access && access.role !== 'platform_admin') {
      throw new ApiError(httpStatus.BAD_REQUEST, "You can't message a business you're part of");
    }
    if (await BlockService.isBlocked(user.id, business.ownerId)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You cannot message this business');
    }
    const conversation = await this.#getOrCreate(business.id, user.id, kind);
    return { conversation: { ...this.#summary(conversation), business: publicBusiness(business) } };
  }

  /**
   * Business: start (or reopen) a thread with someone.
   *   inquiry — only one of its customers (someone who has booked it or been
   *             sent a custom offer)
   *   general — anyone, like a personal profile can (not its own team, and
   *             never across a block)
   * Paid threads open by paying for a priority message (deliverPriority).
   */
  static async openForBusiness(business, customerId, kind = 'inquiry') {
    if (kind === 'general') return this.#openGeneralForBusiness(business, customerId);
    if (kind !== 'inquiry') throw new ApiError(httpStatus.BAD_REQUEST, 'Send a paid message to start this conversation');
    const [booking] = await db
      .select({ id: businessBookings.id })
      .from(businessBookings)
      .where(and(eq(businessBookings.businessId, business.id), eq(businessBookings.customerId, customerId)))
      .limit(1);
    const [offer] = booking
      ? [true]
      : await db
          .select({ id: businessCustomOffers.id })
          .from(businessCustomOffers)
          .where(
            and(eq(businessCustomOffers.businessId, business.id), eq(businessCustomOffers.customerId, customerId))
          )
          .limit(1);
    if (!booking && !offer) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'You can only message customers of this business');
    }
    if (await BlockService.isBlocked(customerId, business.ownerId)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You cannot message this customer');
    }
    const conversation = await this.#getOrCreate(business.id, customerId, 'inquiry');
    const customer = await db.query.users.findFirst({
      where: eq(users.id, customerId),
      columns: CUSTOMER_COLUMNS,
    });
    return { conversation: { ...this.#summary(conversation), customer: customer ?? null } };
  }

  static async #openGeneralForBusiness(business, userId) {
    const person = await this.assertCanReach(business, userId);
    const conversation = await this.#getOrCreate(business.id, userId, 'general');
    return {
      conversation: {
        ...this.#summary(conversation),
        customer: {
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          username: person.username,
          image: person.image,
        },
      },
    };
  }

  /**
   * Can `business` message this person outside of an inquiry (General inbox,
   * paid messages)? Not someone on its own team, not a deleted account, never
   * across a block. Returns the person.
   */
  static async assertCanReach(business, userId) {
    const person = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { ...CUSTOMER_COLUMNS, deletedAt: true },
    });
    if (!person || person.deletedAt) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    const access = await resolveBusinessAccess(business, { id: person.id });
    if (access) throw new ApiError(httpStatus.BAD_REQUEST, `${business.name ?? 'This business'} can't message its own team here`);
    if (await BlockService.isBlocked(userId, business.ownerId)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You cannot message this person');
    }
    return person;
  }

  static async #getOrCreate(businessId, customerId, kind) {
    await db
      .insert(businessConversations)
      .values({ businessId, customerId, kind })
      .onConflictDoNothing({
        target: [businessConversations.businessId, businessConversations.customerId, businessConversations.kind],
      });
    return db.query.businessConversations.findFirst({
      where: and(
        eq(businessConversations.businessId, businessId),
        eq(businessConversations.customerId, customerId),
        eq(businessConversations.kind, kind)
      ),
    });
  }

  // ─── Loading a thread (access checks) ──────────────────────────────────────

  /** The customer's own thread (404 for anyone else — existence stays hidden). */
  static async getForCustomer(user, conversationId) {
    const conversation = await db.query.businessConversations.findFirst({
      where: and(eq(businessConversations.id, conversationId), eq(businessConversations.customerId, user.id)),
      with: { business: { columns: BUSINESS_COLUMNS } },
    });
    if (!conversation || conversation.business?.deletedAt) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
    }
    return conversation;
  }

  /** A thread of `business` (already access-checked by requireBusinessPermission). */
  static async getForBusiness(business, conversationId) {
    const conversation = await db.query.businessConversations.findFirst({
      where: and(eq(businessConversations.id, conversationId), eq(businessConversations.businessId, business.id)),
      with: { customer: { columns: CUSTOMER_COLUMNS } },
    });
    if (!conversation) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
    return { ...conversation, business };
  }

  // ─── Lists ─────────────────────────────────────────────────────────────────

  /** Customer: their threads with businesses, newest first. */
  static async listForCustomer(user, { page = 1, limit = 20 } = {}) {
    limit = clampLimit(limit, 20);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const rows = await db
      .select({
        conversation: businessConversations,
        business: { id: businesses.id, name: businesses.name, slug: businesses.slug, logoUrl: businesses.logoUrl },
        unreadCount: this.#unreadSql('customer'),
      })
      .from(businessConversations)
      .innerJoin(businesses, eq(businesses.id, businessConversations.businessId))
      .where(
        and(
          eq(businessConversations.customerId, user.id),
          isNotNull(businessConversations.lastMessageAt),
          isNull(businesses.deletedAt)
        )
      )
      .orderBy(desc(businessConversations.lastMessageAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const page_ = rows.slice(0, limit);
    const latest = await this.#latestMessages(page_.map(r => r.conversation.id));
    await this.#mask([...latest.values()], user.id);
    const conversations = page_.map(r => ({
      ...this.#summary(r.conversation),
      business: r.business,
      unreadCount: r.unreadCount,
      lastMessage: latest.has(r.conversation.id) ? customerView(latest.get(r.conversation.id)) : null,
    }));
    await this.#stampMedia(conversations.map(c => c.lastMessage).filter(Boolean), 'customer');
    return {
      conversations,
      page: Number(page) || 1,
      limit,
      hasMore,
    };
  }

  /** Business inbox: one inbox's threads, newest first (optionally unread only). */
  static async listForBusiness(business, viewer, { page = 1, limit = 20, unread = false, kind = 'inquiry' } = {}) {
    if (!KINDS.includes(kind)) throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown inbox');
    limit = clampLimit(limit, 20);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const unreadSql = this.#unreadSql('business');
    const rows = await db
      .select({
        conversation: businessConversations,
        customer: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
          image: users.image,
        },
        service: { id: businessServices.id, name: businessServices.name },
        unreadCount: unreadSql,
      })
      .from(businessConversations)
      .innerJoin(users, eq(users.id, businessConversations.customerId))
      .leftJoin(businessServices, eq(businessServices.id, businessConversations.serviceId))
      .where(
        and(
          eq(businessConversations.businessId, business.id),
          eq(businessConversations.kind, kind),
          isNotNull(businessConversations.lastMessageAt),
          unread ? sql`${unreadSql} > 0` : undefined
        )
      )
      .orderBy(desc(businessConversations.lastMessageAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const page_ = rows.slice(0, limit);
    const latest = await this.#latestMessages(page_.map(r => r.conversation.id));
    await this.#mask([...latest.values()], viewer.id);
    const conversations = page_.map(r => ({
      ...this.#summary(r.conversation),
      customer: r.customer,
      service: r.service?.id ? r.service : null,
      unreadCount: r.unreadCount,
      lastMessage: latest.has(r.conversation.id) ? businessView(latest.get(r.conversation.id)) : null,
    }));
    await this.#stampMedia(conversations.map(c => c.lastMessage).filter(Boolean), 'business');
    await this.#stampPriority(conversations.map(c => c.lastMessage).filter(Boolean));
    return {
      conversations,
      page: Number(page) || 1,
      limit,
      hasMore,
    };
  }

  // ─── Messages ──────────────────────────────────────────────────────────────

  /**
   * One page of a thread, oldest → newest. `before` = a message id: returns the
   * messages before it (load older). nextBefore is the cursor for the next page.
   */
  static async listMessages(conversation, side, viewer, { before, limit = 30 } = {}) {
    limit = clampLimit(limit, 30);
    let cursorCond;
    if (before) {
      const cursor = await db.query.businessMessages.findFirst({
        where: and(eq(businessMessages.id, before), eq(businessMessages.conversationId, conversation.id)),
        columns: { id: true, createdAt: true },
      });
      if (!cursor) throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown message cursor');
      cursorCond = sql`(${businessMessages.createdAt}, ${businessMessages.id}) < (${cursor.createdAt}, ${cursor.id})`;
    }
    const rows = await db
      .select()
      .from(businessMessages)
      .where(and(eq(businessMessages.conversationId, conversation.id), cursorCond))
      .orderBy(desc(businessMessages.createdAt), desc(businessMessages.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();
    await this.#mask(messages, viewer.id);
    const senderUsers = side === 'business' ? await this.#senderUsers(messages) : null;
    const views = messages.map(m => (side === 'business' ? businessView(m, senderUsers) : customerView(m)));
    await this.#stampMedia(views, side);
    await this.#stampPriority(views);
    return {
      messages: views,
      hasMore,
      nextBefore: hasMore ? messages[0]?.id : null,
    };
  }

  /**
   * Send into a thread as `side`. Returns the stored message in both views
   * (the controller delivers each to the right people).
   */
  static async send(conversation, side, sender, body) {
    let msg;
    try {
      msg = normalizeMessage(body, side);
    } catch (e) {
      throw new ApiError(httpStatus.BAD_REQUEST, e.message);
    }
    const kind = conversation.kind ?? 'inquiry';
    // Paid inbox is send-only for the business: it continues with another paid message
    if (kind === 'paid' && side === 'business') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Send a paid message to continue this conversation');
    }
    if (msg.messageType === 'inquiry' && kind !== 'inquiry') {
      msg.messageType = 'text';
      delete msg.metadata.inquirySubject;
      delete msg.metadata.serviceId;
    }
    const business =
      conversation.business ??
      (await db.query.businesses.findFirst({
        where: eq(businesses.id, conversation.businessId),
        columns: BUSINESS_COLUMNS,
      }));
    if (!business || business.deletedAt) throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
    if (await BlockService.isBlocked(conversation.customerId, business.ownerId)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You cannot message in this conversation');
    }

    if (msg.messageType === 'image' || msg.messageType === 'video' || msg.messageType === 'file') {
      // Only files the sender uploaded to Briteside — no arbitrary links, and no
      // reusing someone else's upload (ownership is media_owners, see fileTracking.js)
      if (!msg.content.startsWith(FileManagementService.buildPublicUrl(''))) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Attach a file uploaded to Briteside');
      }
      const [file] = await db
        .select({ mediaType: media.mediaType, mimetype: media.mimetype })
        .from(media)
        .innerJoin(mediaOwners, and(eq(mediaOwners.mediaId, media.id), eq(mediaOwners.userId, sender.id)))
        .where(and(eq(media.url, msg.content), isNull(media.deletedAt)))
        .limit(1);
      if (!file) throw new ApiError(httpStatus.BAD_REQUEST, 'Attach a file you uploaded');
      if (msg.messageType !== 'file' && file.mediaType !== msg.messageType) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          msg.messageType === 'image' ? 'That file is not a photo' : 'That file is not a video'
        );
      }
      msg.metadata.mimeType = file.mimetype; // the server's record, not the client's claim
    }
    if (msg.metadata.businessOfferId) {
      const offer = await db.query.businessCustomOffers.findFirst({
        where: and(
          eq(businessCustomOffers.id, msg.metadata.businessOfferId),
          eq(businessCustomOffers.businessId, business.id),
          eq(businessCustomOffers.customerId, conversation.customerId)
        ),
        columns: { id: true },
      });
      if (!offer) throw new ApiError(httpStatus.BAD_REQUEST, 'That offer is not for this customer');
    }
    // Inquiry about a menu service: tag it with the service (this business's
    // own, still on the menu); the name is stored so the tag survives renames
    let inquiryServiceId;
    if (msg.messageType === 'inquiry') {
      inquiryServiceId = null;
      if (msg.metadata.serviceId) {
        const service = await db.query.businessServices.findFirst({
          where: and(
            eq(businessServices.id, msg.metadata.serviceId),
            eq(businessServices.businessId, business.id),
            isNull(businessServices.deletedAt)
          ),
          columns: { id: true, name: true },
        });
        if (service) {
          inquiryServiceId = service.id;
          msg.metadata.serviceName = service.name;
        } else {
          delete msg.metadata.serviceId;
        }
      }
    }

    // Moderation + contact hiding for anything with text (both directions)
    let moderation = { action: 'keep' };
    const hasText = msg.content && (msg.messageType === 'text' || msg.messageType === 'inquiry');
    if (hasText) {
      const unlocked = await InquiryContactService.isUnlockedForBusiness(business.id, conversation.customerId);
      moderation = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.MESSAGE,
        entityCreatorId: sender.id,
        texts: [msg.content],
        mask: !unlocked,
      });
      msg.content = moderation.texts?.[0] ?? msg.content;
      if (!unlocked) {
        const hidden = InquiryContactService.hide({ content: msg.content, metadata: msg.metadata });
        msg.content = hidden.content;
        msg.metadata = hidden.metadata ?? {};
      }
    } else if (msg.metadata.inquirySubject) {
      const unlocked = await InquiryContactService.isUnlockedForBusiness(business.id, conversation.customerId);
      if (!unlocked) msg.metadata = InquiryContactService.hide({ content: '', metadata: msg.metadata }).metadata;
    }

    const now = new Date();
    const stored = await db.transaction(async tx => {
      const [row] = await tx
        .insert(businessMessages)
        .values({
          conversationId: conversation.id,
          senderSide: side,
          senderUserId: sender.id,
          messageType: msg.messageType,
          content: msg.content,
          metadata: msg.metadata,
          createdAt: now,
        })
        .returning();
      // Sending also means you've read everything up to now on your side
      await tx
        .update(businessConversations)
        .set({
          lastMessageAt: now,
          updatedAt: now,
          ...(side === 'customer' ? { customerLastReadAt: now } : { businessLastReadAt: now }),
          // The list's tag follows the latest inquiry
          ...(inquiryServiceId !== undefined ? { serviceId: inquiryServiceId } : {}),
        })
        .where(eq(businessConversations.id, conversation.id));
      return row;
    });

    await TextModerationService.recordIfFlagged(moderation, {
      entityType: TEXT_ENTITY.MESSAGE,
      entityId: stored.id,
      userId: sender.id,
      fieldNames: ['content'],
      texts: [stored.content],
    });

    if (side === 'customer' && stored.messageType === 'inquiry') {
      queueBusinessInboxInquiryEmail({
        business,
        senderId: sender.id,
        conversationId: conversation.id,
        content: stored.content,
        metadata: stored.metadata,
      });
    }

    const senderUsers =
      side === 'business'
        ? new Map([[sender.id, { id: sender.id, firstName: sender.firstName, lastName: sender.lastName, image: sender.image ?? null }]])
        : new Map();
    const customerMessage = customerView(stored);
    const businessMessage = businessView(stored, senderUsers);
    await this.#stampMedia([customerMessage], 'customer');
    await this.#stampMedia([businessMessage], 'business');
    return { business, customerMessage, businessMessage };
  }

  /** Marks everything in the thread read for `side`. */
  static async markRead(conversation, side) {
    const readAt = new Date();
    await db
      .update(businessConversations)
      .set(side === 'customer' ? { customerLastReadAt: readAt } : { businessLastReadAt: readAt })
      .where(eq(businessConversations.id, conversation.id));
    // Reading the thread settles its notifications: the customer's "business
    // replied" ones, or — when anyone on the team reads it — every team
    // member's "new customer message" ones (the thread has been handled).
    await db
      .update(notifications)
      .set({ isRead: true, isSeen: true })
      .where(
        and(
          side === 'customer'
            ? eq(notifications.userId, conversation.customerId)
            : undefined,
          eq(notifications.type, side === 'customer' ? REPLY_NOTIFICATION_TYPE : TEAM_NOTIFICATION_TYPE),
          eq(notifications.relatedId, conversation.id),
          eq(notifications.isRead, false)
        )
      );
    return { conversationId: conversation.id, side, readAt };
  }

  /**
   * Tells the customer the business replied (in-app notification + device
   * push). Shown as the business — its name and logo, never the team member.
   * Skipped when the customer has the thread open (`customerViewing`).
   */
  static async notifyCustomerOfReply(conversation, sent, { customerViewing = false } = {}) {
    if (customerViewing) return;
    const { business, customerMessage } = sent;
    await this.#notifyQuietly({
      userId: conversation.customerId,
      title: business.name,
      message: replyPreview(customerMessage),
      // 'chat_message' → respects the customer's "Chat messages" notification setting
      type: REPLY_NOTIFICATION_TYPE,
      relatedId: conversation.id,
      redirectTo: `/messages/businesses?conversationId=${conversation.id}`,
      metadata: {
        businessInbox: true,
        businessId: business.id,
        conversationId: conversation.id,
        messageId: customerMessage.id,
        // Shown as the notification's picture; also stops it being attributed to a person
        organizerLogoUrl: business.logoUrl ?? null,
      },
    });
  }

  /**
   * Tells the business's inbox team (owner, admins, managers) a customer wrote.
   * Type 'business_message' — the apps show these only while acting as that
   * business, never among the person's own notifications. Team members who
   * have the thread open are skipped (`viewingUserIds`).
   */
  static async notifyTeamOfCustomerMessage(conversation, sent, { viewingUserIds = new Set() } = {}) {
    const { business, businessMessage } = sent;
    const customer = await db.query.users.findFirst({
      where: eq(users.id, conversation.customerId),
      columns: { firstName: true, lastName: true, username: true },
    });
    const customerName =
      [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || customer?.username || 'A customer';
    const isInquiry = businessMessage.messageType === 'inquiry';
    const serviceTag = isInquiry && businessMessage.metadata?.serviceName ? ` · ${businessMessage.metadata.serviceName}` : '';
    const kind = conversation.kind ?? 'inquiry';
    const preview = isInquiry && businessMessage.metadata?.inquirySubject
      ? `New inquiry${serviceTag}: ${businessMessage.metadata.inquirySubject}`
      : kind === 'paid'
        ? `Replied to your paid message: ${teamPreview(businessMessage)}`
        : teamPreview(businessMessage);

    const recipients = (await this.inboxUserIds(business)).filter(id => !viewingUserIds.has(id));
    await Promise.all(
      recipients.map(userId =>
        this.#notifyQuietly({
          userId,
          title: `${customerName} · ${business.name}`,
          message: preview,
          type: TEAM_NOTIFICATION_TYPE,
          relatedId: conversation.id,
          // businessId lets the app switch into this business before opening the thread
          redirectTo: `/business/inbox?businessId=${business.id}&box=${kind}&conversationId=${conversation.id}`,
          metadata: {
            businessInbox: true,
            businessId: business.id,
            conversationId: conversation.id,
            inbox: kind,
            messageId: businessMessage.id,
            actorUserId: conversation.customerId,
          },
        }).catch(err => console.warn(`[businessInbox] team notification for ${userId} failed:`, err.message))
      )
    );
  }

  /**
   * One notification per burst: while the user has an unread one for this
   * thread from the last few minutes, it's updated quietly (no new push);
   * otherwise any older unread one is replaced by a fresh notification.
   */
  static async #notifyQuietly({ userId, type, relatedId, message, metadata, ...rest }) {
    const existing = await db.query.notifications.findFirst({
      where: and(
        eq(notifications.userId, userId),
        eq(notifications.type, type),
        eq(notifications.relatedId, relatedId),
        eq(notifications.isRead, false)
      ),
      orderBy: desc(notifications.createdAt),
    });
    if (existing && Date.now() - new Date(existing.createdAt).getTime() < REPLY_NOTIFICATION_QUIET_MS) {
      await db
        .update(notifications)
        .set({ message, metadata, isSeen: false })
        .where(eq(notifications.id, existing.id));
      return;
    }
    if (existing) await db.delete(notifications).where(eq(notifications.id, existing.id));
    await createNotification({ userId, type, relatedId, message, metadata, ...rest });
  }

  // ─── Badges ────────────────────────────────────────────────────────────────

  /**
   * Business inbox badge: threads with unread customer messages, and the
   * message total — overall and per inbox (`byKind`, unread threads).
   */
  static async unreadForBusiness(businessId) {
    const rows = await db
      .select({
        kind: businessConversations.kind,
        conversations: sql`count(DISTINCT ${businessMessages.conversationId})::int`,
        messages: count(),
      })
      .from(businessMessages)
      .innerJoin(businessConversations, eq(businessConversations.id, businessMessages.conversationId))
      .where(
        and(
          eq(businessConversations.businessId, businessId),
          eq(businessMessages.senderSide, 'customer'),
          or(
            isNull(businessConversations.businessLastReadAt),
            gt(businessMessages.createdAt, businessConversations.businessLastReadAt)
          )
        )
      )
      .groupBy(businessConversations.kind);
    const byKind = Object.fromEntries(KINDS.map(k => [k, 0]));
    let unreadConversations = 0;
    let unreadMessages = 0;
    for (const r of rows) {
      byKind[r.kind] = r.conversations ?? 0;
      unreadConversations += r.conversations ?? 0;
      unreadMessages += Number(r.messages ?? 0);
    }
    return { unreadConversations, unreadMessages, byKind };
  }

  /** Customer badge: unread replies from businesses across all their threads. */
  static async unreadForCustomer(userId) {
    const [row] = await db
      .select({
        conversations: sql`count(DISTINCT ${businessMessages.conversationId})::int`,
        messages: count(),
      })
      .from(businessMessages)
      .innerJoin(businessConversations, eq(businessConversations.id, businessMessages.conversationId))
      .where(
        and(
          eq(businessConversations.customerId, userId),
          eq(businessMessages.senderSide, 'business'),
          or(
            isNull(businessConversations.customerLastReadAt),
            gt(businessMessages.createdAt, businessConversations.customerLastReadAt)
          )
        )
      );
    return { unreadConversations: row?.conversations ?? 0, unreadMessages: Number(row?.messages ?? 0) };
  }

  /** Who answers the inbox: the owner + active team members with 'inbox.manage'. */
  static async inboxUserIds(business) {
    const members = await db
      .select({
        userId: businessTeamMembers.userId,
        role: businessTeamMembers.role,
        locationIds: businessTeamMembers.locationIds,
      })
      .from(businessTeamMembers)
      .where(
        and(
          eq(businessTeamMembers.businessId, business.id),
          eq(businessTeamMembers.status, 'active'),
          isNotNull(businessTeamMembers.userId)
        )
      );
    const ids = new Set([business.ownerId]);
    for (const m of members) {
      if (permissionsForMember(m.role, m.locationIds ?? []).includes(BUSINESS_PERMISSIONS.INBOX_MANAGE)) {
        ids.add(m.userId);
      }
    }
    return [...ids];
  }

  // ─── Paid messages (priority messages sent as the business) ───────────────

  /**
   * Delivers an already-paid priority payment sent as `business` into its
   * paid thread with the talent (PriorityMessageService._deliverPaidPayment):
   * one business message per item, oldest first, carrying metadata.priority.
   * Content was moderated at checkout; contact details are hidden here like
   * in every business thread. Returns the rows in both views.
   */
  static async deliverPriority({ business, talentUserId, senderId, payment, items, attachments = [] }) {
    const conversation = await this.#getOrCreate(business.id, talentUserId, 'paid');
    const unlocked = await InquiryContactService.isUnlockedForBusiness(business.id, talentUserId);
    const start = Date.now();

    const rows = await db.transaction(async tx => {
      const inserted = [];
      for (const [i, item] of items.entries()) {
        let content = `${item.messageContent ?? ''}${item.contentExtended ?? ''}`.trim();
        let subject = item.subject ?? null;
        let contactInfoHidden = false;
        if (!unlocked) {
          const hidden = InquiryContactService.hide({
            content,
            metadata: subject ? { inquirySubject: subject } : {},
          });
          content = hidden.content ?? '';
          subject = hidden.metadata?.inquirySubject ?? subject;
          contactInfoHidden = hidden.hidden;
        }
        const [row] = await tx
          .insert(businessMessages)
          .values({
            conversationId: conversation.id,
            senderSide: 'business',
            senderUserId: senderId,
            messageType: 'text',
            content: content || null,
            metadata: {
              priority: {
                paymentId: payment.id,
                itemId: item.id,
                subject,
                // What the talent earns by replying (whole payment)
                amountCents: payment.baseCents ?? 0,
                ...(i === 0 && attachments.length ? { attachments } : {}),
              },
              ...(contactInfoHidden ? { contactInfoHidden: true } : {}),
            },
            // Keeps the items in order within the same millisecond
            createdAt: new Date(start + i),
          })
          .returning();
        inserted.push(row);
      }
      const last = inserted[inserted.length - 1];
      await tx
        .update(businessConversations)
        .set({ lastMessageAt: last.createdAt, businessLastReadAt: last.createdAt, updatedAt: new Date() })
        .where(eq(businessConversations.id, conversation.id));
      return inserted;
    });

    const sender = await db.query.users.findFirst({
      where: eq(users.id, senderId),
      columns: { id: true, firstName: true, lastName: true, image: true },
    });
    const senderUsers = new Map(sender ? [[sender.id, sender]] : []);
    const customerMessages = rows.map(customerView);
    const businessMessages_ = rows.map(r => businessView(r, senderUsers));
    await this.#stampPriority(customerMessages);
    await this.#stampPriority(businessMessages_);
    return { conversation, rows, customerMessages, businessMessages: businessMessages_ };
  }

  /**
   * Live delivery of a new message: the customer gets the customer view on
   * `user:<customerId>`, every inbox team member the business view.
   */
  static async broadcastMessage(io, conversation, business, side, { customerMessage, businessMessage }) {
    if (!io) return;
    const base = { businessId: business.id, conversationId: conversation.id, kind: conversation.kind ?? 'inquiry', side };
    emitSocialChat(io, `user:${conversation.customerId}`, 'business-inbox:message:new', {
      ...base,
      message: customerMessage,
    });
    for (const userId of await this.inboxUserIds(business)) {
      emitSocialChat(io, `user:${userId}`, 'business-inbox:message:new', { ...base, message: businessMessage });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Paid messages: stamps each view carrying metadata.priority with its
   * item's status — 'pending' (awaiting the talent's reply), 'replied', or
   * 'expired' (not answered in time; refunded) — and when the reply window
   * closes. Mutates the given views.
   */
  static async #stampPriority(views) {
    const withPriority = views.filter(v => v?.metadata?.priority?.itemId);
    if (!withPriority.length) return;
    const ids = [...new Set(withPriority.map(v => v.metadata.priority.itemId))];
    const rows = await db
      .select({
        id: priorityMessageItems.id,
        status: priorityMessageItems.status,
        deliveredAt: priorityMessageItems.deliveredAt,
      })
      .from(priorityMessageItems)
      .where(inArray(priorityMessageItems.id, ids));
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const v of withPriority) {
      const item = byId.get(v.metadata.priority.itemId);
      v.priorityStatus = item?.status ?? 'pending';
      const deliveredAt = item?.deliveredAt ?? v.createdAt;
      v.priorityReplyBy = deliveredAt
        ? new Date(new Date(deliveredAt).getTime() + PRIORITY_REPLY_WINDOW_MS).toISOString()
        : null;
    }
  }

  static #summary(c) {
    return {
      id: c.id,
      businessId: c.businessId,
      customerId: c.customerId,
      kind: c.kind ?? 'inquiry',
      serviceId: c.serviceId ?? null,
      lastMessageAt: c.lastMessageAt,
      customerLastReadAt: c.customerLastReadAt,
      businessLastReadAt: c.businessLastReadAt,
      createdAt: c.createdAt,
    };
  }

  /** Messages from the other side newer than `side`'s lastReadAt. */
  static #unreadSql(side) {
    const from = otherSide(side);
    const lastRead =
      side === 'customer' ? businessConversations.customerLastReadAt : businessConversations.businessLastReadAt;
    return sql`(
      SELECT count(*)::int FROM ${businessMessages}
      WHERE ${businessMessages.conversationId} = ${businessConversations.id}
        AND ${businessMessages.senderSide} = ${from}
        AND ${businessMessages.createdAt} > COALESCE(${lastRead}, '-infinity'::timestamptz)
    )`.mapWith(Number);
  }

  static async #latestMessages(conversationIds) {
    if (!conversationIds.length) return new Map();
    const rows = await db
      .selectDistinctOn([businessMessages.conversationId])
      .from(businessMessages)
      .where(inArray(businessMessages.conversationId, conversationIds))
      .orderBy(asc(businessMessages.conversationId), desc(businessMessages.createdAt), desc(businessMessages.id));
    return new Map(rows.map(r => [r.conversationId, r]));
  }

  static async #senderUsers(messages) {
    const ids = [...new Set(messages.filter(m => m.senderSide === 'business' && m.senderUserId).map(m => m.senderUserId))];
    if (!ids.length) return new Map();
    const rows = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, image: users.image })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map(u => [u.id, u]));
  }

  /**
   * Photos / videos: stamps each message view with its moderation verdict
   * (moderationStatus) and, while it's held (pending review, rejected…),
   * removes the file URL for the other side — the sender's side still sees it
   * with an "under review" / "removed" state. Mutates the given views.
   */
  static async #stampMedia(views, viewerSide) {
    const withMedia = views.filter(v => (v.messageType === 'image' || v.messageType === 'video') && v.content);
    if (!withMedia.length) return;
    const rows = await MediaModerationService.mediaRowsForUrls(withMedia.map(v => v.content));
    const statusByUrl = new Map(rows.map(r => [r.url, r.status]));
    for (const v of withMedia) applyMediaVerdict(v, statusByUrl.get(v.content), viewerSide, HELD_FROM_OTHERS);
  }

  /** Applies the viewer's own profanity-filter setting to flagged text. */
  static async #mask(messages, viewerId) {
    if (!messages.length) return;
    const filterEnabled = await TextModerationService.getFilterEnabled(viewerId);
    await TextModerationService.maskFlaggedText(messages, {
      entityType: TEXT_ENTITY.MESSAGE,
      fields: ['content'],
      filterEnabled,
    });
  }
}
