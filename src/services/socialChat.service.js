import { db } from '../db/index.js';
import {
  socialConversations,
  socialMessages,
  users,
  discussions,
  organizers,
} from '../db/schema/index.js';
import { eq, and, or, desc, sql, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import ApiError from '../utils/api-error.js';
import { priorityMessagePayments } from '../db/schema/priorityMessagePayments.js';
import { priorityMessageAttachments } from '../db/schema/priorityMessageAttachments.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';
import { MediaModerationService } from './moderation/mediaModeration.service.js';
import { BlockService } from './social/block.service.js';
function orderUserPair(userId1, userId2) {
  return userId1 < userId2 ? { a: userId1, b: userId2 } : { a: userId2, b: userId1 };
}

export class SocialChatService {
  // ─── Helpers ────────────────────────────────────────────────────────────────

  static async getLatestInboundMessages(currentUserId, conversationIds = []) {
    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return { latestMap: new Map(), unreadCountMap: new Map() };
    }

    const inboundMessages = await db
      .select({
        id: socialMessages.id,
        conversationId: socialMessages.conversationId,
        senderId: socialMessages.senderId,
        messageType: socialMessages.messageType,
        content: socialMessages.content,
        metadata: socialMessages.metadata,
        isSeen: socialMessages.isSeen,
        isPriority: socialMessages.isPriority,
        createdAt: socialMessages.createdAt,
      })
      .from(socialMessages)
      .where(inArray(socialMessages.conversationId, conversationIds))
      .orderBy(desc(socialMessages.createdAt));

    const latestMap = new Map();
    const unreadCountMap = new Map();

    for (const m of inboundMessages) {
      if (!latestMap.has(m.conversationId)) {
        latestMap.set(m.conversationId, m);
      }
      if (!m.isSeen && m.senderId !== currentUserId) {
        unreadCountMap.set(m.conversationId, (unreadCountMap.get(m.conversationId) ?? 0) + 1);
      }
    }

    return { latestMap, unreadCountMap };
  }

  static async getLatestInboundMessagesByPriority(
    currentUserId,
    conversationIds = [],
    { isPriority }
  ) {
    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return { latestMap: new Map(), unreadCountMap: new Map() };
    }

    const inboundMessages = await db
      .select({
        id: socialMessages.id,
        conversationId: socialMessages.conversationId,
        senderId: socialMessages.senderId,
        messageType: socialMessages.messageType,
        content: socialMessages.content,
        metadata: socialMessages.metadata,
        isSeen: socialMessages.isSeen,
        isPriority: socialMessages.isPriority,
        createdAt: socialMessages.createdAt,
      })
      .from(socialMessages)
      .where(
        and(
          inArray(socialMessages.conversationId, conversationIds),
          ne(socialMessages.messageType, 'inquiry'),
          eq(socialMessages.isPriority, isPriority)
        )
      )
      .orderBy(desc(socialMessages.createdAt));

    const latestMap = new Map();
    const unreadCountMap = new Map();

    for (const m of inboundMessages) {
      if (!latestMap.has(m.conversationId)) {
        latestMap.set(m.conversationId, m);
      }
      if (!m.isSeen && m.senderId !== currentUserId) {
        unreadCountMap.set(m.conversationId, (unreadCountMap.get(m.conversationId) ?? 0) + 1);
      }
    }

    return { latestMap, unreadCountMap };
  }

  static async getLatestInboundInquiries(currentUserId, conversationIds = []) {
    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return { latestMap: new Map(), unreadCountMap: new Map() };
    }

    const inboundMessages = await db
      .select({
        id: socialMessages.id,
        conversationId: socialMessages.conversationId,
        senderId: socialMessages.senderId,
        messageType: socialMessages.messageType,
        content: socialMessages.content,
        metadata: socialMessages.metadata,
        isSeen: socialMessages.isSeen,
        isPriority: socialMessages.isPriority,
        createdAt: socialMessages.createdAt,
      })
      .from(socialMessages)
      .where(
        and(
          inArray(socialMessages.conversationId, conversationIds),
          eq(socialMessages.messageType, 'inquiry')
        )
      )
      .orderBy(desc(socialMessages.createdAt));

    const latestMap = new Map();
    const unreadCountMap = new Map();

    for (const m of inboundMessages) {
      // Latest message overall (for preview) — first one per conversation due to desc order
      if (!latestMap.has(m.conversationId)) {
        latestMap.set(m.conversationId, m);
      }
      // Only count unseen messages FROM the other user as unread
      if (!m.isSeen && m.senderId !== currentUserId) {
        unreadCountMap.set(m.conversationId, (unreadCountMap.get(m.conversationId) ?? 0) + 1);
      }
    }
    return { latestMap, unreadCountMap };
  }

  static async getLatestInboundMessage(currentUserId, conversationId) {
    const { latestMap } = await this.getLatestInboundMessages(currentUserId, [conversationId]);
    return latestMap.get(conversationId) || null;
  }

  // ─── Conversations ───────────────────────────────────────────────────────────

  // type = 'general' → exclude inquiry messageType
  // type = 'inquiry' → only inquiry messageType
  // type = 'all'     → no filter
  // conversationType = 'social' | 'organizer' | undefined (no filter)
  static async listConversations(
    currentUserId,
    { page = 1, limit = 20, type = 'all', conversationType } = {}
  ) {
    const offset = (page - 1) * limit;

    const uA = alias(users, 'user_a');
    const uB = alias(users, 'user_b');
    const orgA = alias(organizers, 'org_a');
    const orgB = alias(organizers, 'org_b');

    const rows = await db
      .select({
        conversation: {
          id: socialConversations.id,
          userAId: socialConversations.userAId,
          userBId: socialConversations.userBId,
          conversationType: socialConversations.conversationType,
          organizerUserId: socialConversations.organizerUserId,
          createdAt: socialConversations.createdAt,
          deletedAt: socialConversations.deletedAt,
          updatedAt: socialConversations.updatedAt,
        },
        userA: {
          id: uA.id,
          firstName: uA.firstName,
          lastName: uA.lastName,
          image: uA.image,
          lastSeen: uA.lastSeen,
          showOnlineStatus: uA.showOnlineStatus,
          showLastSeen: uA.showLastSeen,
          username: uA.username,
          email: uA.email,
        },
        userB: {
          id: uB.id,
          firstName: uB.firstName,
          lastName: uB.lastName,
          image: uB.image,
          lastSeen: uB.lastSeen,
          showOnlineStatus: uB.showOnlineStatus,
          showLastSeen: uB.showLastSeen,
          username: uB.username,
          email: uB.email,
        },
        orgA: {
          businessName: orgA.businessName,
          logoUrl: orgA.logoUrl,
        },
        orgB: {
          businessName: orgB.businessName,
          logoUrl: orgB.logoUrl,
        },
      })
      .from(socialConversations)
      .leftJoin(uA, eq(uA.id, socialConversations.userAId))
      .leftJoin(uB, eq(uB.id, socialConversations.userBId))
      .leftJoin(orgA, eq(orgA.userId, socialConversations.userAId))
      .leftJoin(orgB, eq(orgB.userId, socialConversations.userBId))
      .where(
        and(
          or(
            eq(socialConversations.userAId, currentUserId),
            eq(socialConversations.userBId, currentUserId)
          ),
          conversationType ? eq(socialConversations.conversationType, conversationType) : undefined
        )
      )
      .orderBy(
  desc(sql`COALESCE(${socialConversations.lastMessageAt}, ${socialConversations.createdAt})`)
)
.limit(limit)
.offset(offset);

    const conversationIds = rows.map(r => r.conversation.id).filter(Boolean);
    const rawRowCount = rows.length; 
    const { latestMap, unreadCountMap } =
      type === 'inquiry'
        ? await this.getLatestInboundInquiries(currentUserId, conversationIds)
        : await this.getLatestInboundMessages(currentUserId, conversationIds);

    // ── NEW: split "latest message" into general vs priority so each tab can
    // preview the correct content/unread state, independent of whichever type
    // happened most recently in the thread.
    let generalLatestMap = new Map();
    let generalUnreadMap = new Map();
    let priorityLatestMap = new Map();
    let priorityUnreadMap = new Map();

    if (type !== 'inquiry' && conversationIds.length > 0) {
      const generalResult = await this.getLatestInboundMessagesByPriority(
        currentUserId,
        conversationIds,
        { isPriority: false }
      );
      generalLatestMap = generalResult.latestMap;
      generalUnreadMap = generalResult.unreadCountMap;

      const priorityResult = await this.getLatestInboundMessagesByPriority(
        currentUserId,
        conversationIds,
        { isPriority: true }
      );
      priorityLatestMap = priorityResult.latestMap;
      priorityUnreadMap = priorityResult.unreadCountMap;
    }

    let outstandingPrioritySet = new Set();
    let anyPrioritySet = new Set();
    if (conversationIds.length > 0) {
      const outstandingRows = await db
        .select({ conversationId: priorityMessagePayments.conversationId })
        .from(priorityMessagePayments)
        .where(
          and(
            inArray(priorityMessagePayments.conversationId, conversationIds),
            inArray(priorityMessagePayments.status, ['paid', 'partial'])
          )
        );
      outstandingPrioritySet = new Set(outstandingRows.map(r => r.conversationId));

      // NEW: any payment regardless of status → "has priority history"
      const anyPriorityRows = await db
        .select({ conversationId: priorityMessagePayments.conversationId })
        .from(priorityMessagePayments)
        .where(inArray(priorityMessagePayments.conversationId, conversationIds));
      anyPrioritySet = new Set(anyPriorityRows.map(r => r.conversationId));
    }

    let items = rows.map(r => {
      const isOtherA = r.conversation.userBId === currentUserId;
      const otherUser = isOtherA ? r.userA : r.userB;
      const otherOrg = isOtherA ? r.orgA : r.orgB;
      const lastInbound = latestMap.get(r.conversation.id) || null;
      const lastGeneral = generalLatestMap.get(r.conversation.id) || null;
      const lastPriority = priorityLatestMap.get(r.conversation.id) || null;

      let secondUser = null;
      if (otherUser) {
        secondUser = {
          id: otherUser.id,
          firstName: otherUser.firstName,
          lastName: otherUser.lastName,
          image: otherUser.image,
          lastSeen: otherUser.lastSeen,
          showOnlineStatus: otherUser.showOnlineStatus,
          showLastSeen: otherUser.showLastSeen,
          username: otherUser.username,
          email: otherUser.email,
        };
        if (r.conversation.organizerUserId === otherUser.id && otherOrg?.businessName) {
          secondUser.displayName = otherOrg.businessName;
          secondUser.displayImage = otherOrg.logoUrl;
        }
      }

      const toPreview = m =>
        m
          ? {
              id: m.id,
              senderId: m.senderId,
              messageType: m.messageType,
              content: m.content,
              metadata: m.metadata,
              isSeen: m.isSeen,
              isPriority: m.isPriority,
              createdAt: m.createdAt,
            }
          : null;

      return {
        ...r.conversation,
        secondUser,
        lastMessageSent: toPreview(lastInbound),
        lastGeneralMessageSent: toPreview(lastGeneral),
        lastPriorityMessageSent: toPreview(lastPriority),
        unreadCount: unreadCountMap.get(r.conversation.id) ?? 0,
        generalUnreadCount: generalUnreadMap.get(r.conversation.id) ?? 0,
        priorityUnreadCount: priorityUnreadMap.get(r.conversation.id) ?? 0,
        hasOutstandingPriority: outstandingPrioritySet.has(r.conversation.id),
        hasPriorityHistory: anyPrioritySet.has(r.conversation.id),
      };
    });

    if (type === 'inquiry') {
      items = items.filter(item => item.lastMessageSent?.messageType === 'inquiry');
    } else if (type === 'general') {
      items = items.filter(item => item.lastMessageSent?.messageType !== 'inquiry');
    }

   const conversationsFilterEnabled = await TextModerationService.getFilterEnabled(currentUserId);
    const allPreviews = items
      .flatMap(item => [
        item.lastMessageSent,
        item.lastGeneralMessageSent,
        item.lastPriorityMessageSent,
      ])
      .filter(Boolean);
    await TextModerationService.maskFlaggedText(allPreviews, {
      entityType: TEXT_ENTITY.MESSAGE,
      fields: ['content'],
      filterEnabled: conversationsFilterEnabled,
    });

    items = items.map(item => ({ ...item, conversationKind: 'social' }));

    // Group chats surface in the General tab too — inquiries don't apply to
    // groups, so they're left out of that tab.
    let groupItems = [];
    if (type !== 'inquiry') {
      const { GroupChatService } = await import('./groupChat.service.js');
      groupItems = await GroupChatService.listGroupChatsForUser(currentUserId);
    }
    const combined = [...items, ...groupItems].sort((a, b) => {
      const aTime = new Date(a.lastMessageSent?.createdAt || a.createdAt).getTime();
      const bTime = new Date(b.lastMessageSent?.createdAt || b.createdAt).getTime();
      return bTime - aTime;
    });

    return {
      conversations: combined,
      page,
      limit,
       hasMore: items.length === limit,
    };
  }

  static async getOrCreateConversation(currentUserId, otherUserId, conversationType = 'social') {
    if (currentUserId === otherUserId) {
      throw new ApiError(400, 'Cannot create conversation with yourself');
    }

    const other = await db.query.users.findFirst({
      where: eq(users.id, otherUserId),
    });
    if (!other) throw new ApiError(404, 'Other user not found');

    const { a, b } = orderUserPair(currentUserId, otherUserId);

    const existing = await db.query.socialConversations.findFirst({
      where: and(
        eq(socialConversations.userAId, a),
        eq(socialConversations.userBId, b),
        eq(socialConversations.conversationType, conversationType)
      ),
    });
    if (existing) return existing;

    // Only guards starting a brand-new thread — an existing conversation is
    // still returned above so message history stays viewable; sendMessage is
    // the actual gate on new messages either direction of a block.
    if (await BlockService.isBlocked(currentUserId, otherUserId)) {
      throw new ApiError(403, 'You cannot start a conversation with this user');
    }

    const [created] = await db
      .insert(socialConversations)
      .values({
        userAId: a,
        userBId: b,
        conversationType,
        organizerUserId: conversationType === 'organizer' ? otherUserId : null,
        createdAt: new Date(),
        createdBy: currentUserId,
        updatedBy: currentUserId,
      })
      .returning();

    return created;
  }

  static async getConversation(currentUserId, conversationId) {
    const convo = await db.query.socialConversations.findFirst({
      where: eq(socialConversations.id, conversationId),
    });
    if (!convo) throw new ApiError(404, 'Conversation not found');
    if (convo.userAId !== currentUserId && convo.userBId !== currentUserId) {
      throw new ApiError(403, 'Not allowed');
    }
    return convo;
  }

  static async deleteConversation(currentUserId, conversationId) {
    const convo = await this.getConversation(currentUserId, conversationId);
    await db.delete(socialConversations).where(eq(socialConversations.id, convo.id));
    return { success: true };
  }

  // ─── Messages ────────────────────────────────────────────────────────────────

  static async sendMessage(
    currentUserId,
    conversationId,
    {
      messageType = 'text',
      content = null,
      metadata = {},
      replyToId = null,
      isPriority = false,
      // Internal only — set exclusively by trusted server-to-server callers
      // (e.g. PriorityMessageService delivering a paid message after Stripe
      // payment succeeds). That content was already moderated once at
      // checkout time (createCheckout), before payment. It must never be
      // settable from the public controller/req.body, or a client could
      // grant themselves a moderation bypass.
      skipModeration = false,
    }
  ) {
    const convo = await this.getConversation(currentUserId, conversationId);
    const otherUserId = convo.userAId === currentUserId ? convo.userBId : convo.userAId;
    if (await BlockService.isBlocked(currentUserId, otherUserId)) {
      throw new ApiError(403, 'You cannot message this user');
    }

    const resolvedIsPriority = messageType === 'inquiry' ? false : isPriority;

    if (replyToId) {
      const parent = await db.query.socialMessages.findFirst({
        where: eq(socialMessages.id, replyToId),
        columns: { id: true, conversationId: true, isPriority: true },
      });
      if (!parent) throw new ApiError(404, 'Replied-to message not found');
      if (parent.conversationId !== convo.id) {
        throw new ApiError(400, 'Reply must reference a message in the same conversation');
      }
    }

    // General (private 1:1) conversation is NOT moderated. Only inquiry and
    // priority messages — business/paid, talent-facing — are checked. Content
    // already vetted by a trusted delivery path (skipModeration) is never
    // re-checked here.
    let finalContent = content;
    let messageModeration = { action: 'keep' };
    if (!skipModeration && (messageType === 'inquiry' || resolvedIsPriority)) {
      messageModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.MESSAGE,
        entityCreatorId: currentUserId,
        texts: [content],
        mask: true,
      });
      finalContent = messageModeration.texts[0];
    }

    const [msg] = await db
      .insert(socialMessages)
      .values({
        conversationId: convo.id,
        senderId: currentUserId,
        messageType,
        content: finalContent,
        replyToId: replyToId || null,
        isPriority: resolvedIsPriority,
        metadata,
        isSeen: false,
        createdBy: currentUserId,
        updatedBy: currentUserId,
        createdAt: new Date(),
      })
      .returning();
      if (messageType !== 'inquiry') {
  await db
    .update(socialConversations)
    .set({ lastMessageAt: msg.createdAt })
    .where(eq(socialConversations.id, convo.id));
}

    await TextModerationService.recordIfFlagged(messageModeration, {
      entityType: TEXT_ENTITY.MESSAGE,
      entityId: msg.id,
      userId: currentUserId,
      fieldNames: ['content'],
      texts: [finalContent],
    });

    const message = await db.query.socialMessages.findFirst({
      where: eq(socialMessages.id, msg.id),
      with: {
        sender: {
          columns: { id: true, firstName: true, lastName: true },
        },
        conversation: {
          columns: { id: true, userAId: true, userBId: true },
        },
        replyTo: {
          columns: {
            id: true,
            senderId: true,
            messageType: true,
            content: true,
            createdAt: true,
          },
          with: {
            sender: { columns: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    return message;
  }

  static async getMessages(
    currentUserId,
    conversationId,
    { page = 1, limit = 50, priorityOnly = false, inquiryOnly = false } = {}
  ) {
    const convo = await this.getConversation(currentUserId, conversationId);
    const offset = (page - 1) * limit;

    const messages = await db.query.socialMessages.findMany({
      where: eq(socialMessages.conversationId, convo.id),
      with: {
        sender: {
          columns: { id: true, firstName: true, lastName: true },
        },
        replyTo: {
          columns: {
            id: true,
            senderId: true,
            messageType: true,
            content: true,
            createdAt: true,
          },
          with: {
            sender: { columns: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: desc(socialMessages.createdAt),
      limit,
      offset,
    });

    let filtered;
    if (inquiryOnly) {
      filtered = messages.filter(m => m.messageType === 'inquiry');
    } else if (priorityOnly) {
      filtered = messages.filter(m => m.isPriority === true && m.messageType !== 'inquiry');
    } else {
      filtered = messages.filter(m => m.messageType !== 'inquiry');
    }

    // Enrich priority messages with attachment data
    const priorityMsgs = filtered.filter(m => m.isPriority && m.metadata?.paymentId);
    if (priorityMsgs.length > 0) {
      const paymentIds = [...new Set(priorityMsgs.map(m => m.metadata.paymentId))];
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
      const attachMap = new Map();
      for (const a of attachmentRows) {
        const moderationStatus = attachmentModerationMap.get(a.mediaId) ?? 'approved';
        // A refund not caused by moderation (e.g. 48h no-reply) stays hidden,
        // same as before. A moderation-rejected one stays visible so the
        // thread can show a "removed for violating guidelines" placeholder.
        if (a.status === 'refunded' && moderationStatus !== 'rejected') continue;
        if (!attachMap.has(a.paymentId)) attachMap.set(a.paymentId, []);
        attachMap.get(a.paymentId).push({
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
      for (const m of priorityMsgs) {
        const atts = attachMap.get(m.metadata.paymentId);
        if (atts?.length) m.metadata = { ...m.metadata, priorityAttachments: atts };
      }
    }

    // Priority image/video messages sent directly (messageType image/video,
    // content = the file URL) bypass the paid-attachment table entirely, so
    // they need their own lookup by URL to blur/flag in the thread.
    const priorityMediaMsgs = filtered.filter(
      m => m.isPriority && (m.messageType === 'image' || m.messageType === 'video') && m.content
    );
    if (priorityMediaMsgs.length > 0) {
      const mediaRows = await MediaModerationService.mediaRowsForUrls(
        priorityMediaMsgs.map(m => m.content)
      );
      const statusByUrl = new Map(mediaRows.map(r => [r.url, r.status ?? 'approved']));
      for (const m of priorityMediaMsgs) {
        m.moderationStatus = statusByUrl.get(m.content) ?? 'approved';
      }
    }

    const messageFilterEnabled = await TextModerationService.getFilterEnabled(currentUserId);
    await TextModerationService.maskFlaggedText(filtered, {
      entityType: TEXT_ENTITY.MESSAGE,
      fields: ['content'],
      filterEnabled: messageFilterEnabled,
    });

    return {
      messages: filtered.reverse(),
      page,
      limit,
      hasMore: messages.length === limit,
    };
  }

  static async updateMessage(currentUserId, messageId, { content, metadata }) {
    const message = await db.query.socialMessages.findFirst({
      where: eq(socialMessages.id, messageId),
      columns: {
        id: true,
        senderId: true,
        conversationId: true,
        deletedAt: true,
        messageType: true,
        isPriority: true,
      },
    });

    if (!message) throw new ApiError(404, 'Message not found');
    if (message.senderId !== currentUserId) throw new ApiError(403, 'Not allowed');
    if (message.deletedAt) throw new ApiError(400, 'Cannot update deleted message');

    // General (private 1:1) conversation is NOT moderated — only inquiry + priority.
    let finalContent = content;
    let messageModeration = { action: 'keep' };
    if (message.messageType === 'inquiry' || message.isPriority) {
      messageModeration = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.MESSAGE,
        entityId: messageId,
        entityCreatorId: currentUserId,
        texts: [content],
        mask: true,
      });
      finalContent = messageModeration.texts[0];
    }

    await db
      .update(socialMessages)
      .set({
        content: finalContent,
        metadata,
        updatedBy: currentUserId,
        updatedAt: new Date(),
      })
      .where(eq(socialMessages.id, messageId));

    await TextModerationService.recordIfFlagged(messageModeration, {
      entityType: TEXT_ENTITY.MESSAGE,
      entityId: messageId,
      userId: currentUserId,
      fieldNames: ['content'],
      texts: [finalContent],
    });

    return {
      success: true,
      conversationId: message.conversationId,
      messageId,
    };
  }

  static async markMessageSeen(currentUserId, messageId) {
    const message = await db.query.socialMessages.findFirst({
      where: eq(socialMessages.id, messageId),
      with: { conversation: true },
    });
    if (!message) throw new ApiError(404, 'Message not found');

    const convo = message.conversation;
    const isParticipant = convo.userAId === currentUserId || convo.userBId === currentUserId;
    if (!isParticipant) throw new ApiError(403, 'Not allowed');

    if (message.senderId === currentUserId) {
      throw new ApiError(400, 'Sender cannot mark their own message as seen');
    }

    await db
      .update(socialMessages)
      .set({ isSeen: true, seenAt: new Date() })
      .where(eq(socialMessages.id, messageId));

    return {
      success: true,
      conversationId: convo.id,
      messageId,
      senderId: message.senderId,
    };
  }

static async markAllSeenInConversation(
  currentUserId,
  conversationId,
  { isPriority, inquiryOnly = false } = {}
) {
  const convo = await this.getConversation(currentUserId, conversationId);

  const conditions = [
    eq(socialMessages.conversationId, convo.id),
    eq(socialMessages.isSeen, false),
    ne(socialMessages.senderId, currentUserId),
  ];


  if (inquiryOnly) {
    conditions.push(eq(socialMessages.messageType, 'inquiry'));
  } else {
    conditions.push(ne(socialMessages.messageType, 'inquiry'));
 // Allow scoping to general-only or priority-only seen-marking, since the
    // General tab and Priority tab render two different message subsets and
    // each should only mark its own subset seen when opened.
    if (typeof isPriority === 'boolean') {
      conditions.push(eq(socialMessages.isPriority, isPriority));
    }
  }

  const updated = await db
    .update(socialMessages)
    .set({ isSeen: true, seenAt: new Date() })
    .where(and(...conditions))
    .returning({ id: socialMessages.id, senderId: socialMessages.senderId });

  return {
    success: true,
    conversationId: convo.id,
    markedCount: updated.length,
    messageIds: updated.map(m => m.id),
    // senderId is the same for every row in a 1:1 conversation — useful
    // for the controller to emit a single socket "seen" event back to them
    senderId: updated[0]?.senderId ?? null,
  };
}

  static async deleteMessage(currentUserId, messageId) {
    const message = await db.query.socialMessages.findFirst({
      where: eq(socialMessages.id, messageId),
      columns: { id: true, senderId: true, conversationId: true },
    });
    if (!message) throw new ApiError(404, 'Message not found');
    if (message.senderId !== currentUserId) throw new ApiError(403, 'Not allowed');

    await db.delete(socialMessages).where(eq(socialMessages.id, messageId));
    return { success: true, conversationId: message.conversationId, messageId };
  }

  // ─── Sharing ─────────────────────────────────────────────────────────────────

  static async sharePostToUsers(currentUserId, postId, recipientUserIds, message = '') {
    const { posts, stories, groups } = await import('../db/schema/index.js');

    let post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: {
        user: {
          columns: { id: true, username: true, firstName: true, lastName: true, image: true },
        },
      },
    });

    let isStory = false;
    let isGroup = false;
    let isProfile = false;

    if (!post) {
      const story = await db.query.stories.findFirst({
        where: eq(stories.id, postId),
        with: {
          user: {
            columns: { id: true, username: true, firstName: true, lastName: true, image: true },
          },
        },
      });

      if (story) {
        if (
          story.expiresAt < new Date() &&
          !(await StoryService.isStoryFavourited(story.id, currentUserId))
        ) {
          throw new ApiError(410, 'Story has expired');
        }

        isStory = true;
        post = {
          id: story.id,
          caption: story.caption ?? null,
          mediaUrls: [story.mediaUrl],
          mediaTypes: [story.mediaType],
          likesCount: story.likesCount ?? 0,
          commentsCount: story.commentsCount ?? 0,
          sharesCount: story.sharesCount ?? 0,
          user: story.user,
          _storyExpiresAt: story.expiresAt,
        };
      } else {
        // NEW: fall back to groups
        const group = await db.query.groups.findFirst({
          where: and(eq(groups.id, postId), sql`${groups.deletedAt} IS NULL`),
        });

        if (group) {
          isGroup = true;
          post = {
            id: group.id,
            caption: group.name ?? null,
            mediaUrls: [group.coverImageUrl].filter(Boolean),
            mediaTypes: ['image'],
            user: null,
            _groupSlug: group.slug,
            _groupName: group.name,
          };
        } else {
          // NEW: fall back to sharing a user's profile
          const sharedUser = await db.query.users.findFirst({
            where: eq(users.id, postId),
            with: {
              socialProfile: { columns: { bio: true, coverImages: true } },
            },
          });

          if (!sharedUser) throw new ApiError(404, 'Post, story, group, or user not found');

          isProfile = true;
          post = {
            id: sharedUser.id,
            caption: sharedUser.socialProfile?.bio ?? null,
            mediaUrls: [sharedUser.image ?? sharedUser.socialProfile?.coverImages?.[0]].filter(
              Boolean
            ),
            mediaTypes: ['image'],
            user: {
              id: sharedUser.id,
              username: sharedUser.username,
              firstName: sharedUser.firstName,
              lastName: sharedUser.lastName,
              image: sharedUser.image,
            },
          };
        }
      }
    }

    const uniqueRecipients = [...new Set(recipientUserIds)].filter(id => id !== currentUserId);
    if (uniqueRecipients.length === 0) throw new ApiError(400, 'No valid recipients provided');

    const results = [];

    for (const recipientId of uniqueRecipients) {
      try {
        const recipient = await db.query.users.findFirst({ where: eq(users.id, recipientId) });
        if (!recipient) {
          results.push({ userId: recipientId, success: false, error: 'User not found' });
          continue;
        }

        const conversation = await this.getOrCreateConversation(currentUserId, recipientId);

        const messageType = isGroup ? 'group' : isStory ? 'story' : isProfile ? 'profile' : 'post';
        const defaultContent = isGroup
          ? 'Shared a group with you'
          : isStory
            ? 'Shared a story with you'
            : isProfile
              ? 'Shared a profile with you'
              : 'Shared a post with you';

        const metadata = isGroup
          ? {
              groupId: post.id,
              sharedGroup: {
                id: post.id,
                name: post._groupName,
                slug: post._groupSlug,
                coverImageUrl: post.mediaUrls?.[0] ?? null,
              },
            }
          : isStory
            ? {
                storyId: post.id,
                sharedStory: {
                  id: post.id,
                  caption: post.caption,
                  mediaUrl: post.mediaUrls?.[0],
                  mediaType: post.mediaTypes?.[0],
                  expiresAt: post._storyExpiresAt,
                  user: post.user,
                },
              }
            : isProfile
              ? {
                  profileUserId: post.id,
                  sharedProfile: {
                    id: post.user.id,
                    username: post.user.username,
                    firstName: post.user.firstName,
                    lastName: post.user.lastName,
                    image: post.user.image,
                  },
                }
              : {
                  postId,
                  sharedPost: {
                    id: post.id,
                    caption: post.caption,
                    mediaUrls: post.mediaUrls,
                    mediaTypes: post.mediaTypes,
                    likesCount: post.likesCount,
                    commentsCount: post.commentsCount,
                    user: post.user,
                  },
                };

        const msg = await this.sendMessage(currentUserId, conversation.id, {
          messageType,
          content: message || defaultContent,
          metadata,
        });

        results.push({
          userId: recipientId,
          success: true,
          conversationId: conversation.id,
          messageId: msg.id,
          // Full hydrated message (sender/replyTo included) — the controller
          // uses this to also emit social:message:new, the same event a
          // regular sent message gets, so the recipient's inbox updates live
          // instead of only surfacing via the separate share-notification.
          message: msg,
        });
      } catch (error) {
        results.push({
          userId: recipientId,
          success: false,
          error: error.message || 'Failed to share',
        });
      }
    }

    // Only bump share counters for the content types that actually have one
    // (groups and profiles don't track a sharesCount)
    if (isStory) {
      await db
        .update(stories)
        .set({ sharesCount: sql`${stories.sharesCount} + ${uniqueRecipients.length}` })
        .where(eq(stories.id, postId));
    } else if (!isGroup && !isProfile) {
      await db
        .update(posts)
        .set({ sharesCount: sql`${posts.sharesCount} + ${uniqueRecipients.length}` })
        .where(eq(posts.id, postId));
    }

    return {
      postId,
      contentType: isGroup ? 'group' : isStory ? 'story' : isProfile ? 'profile' : 'post',
      totalRecipients: uniqueRecipients.length,
      successCount: results.filter(r => r.success).length,
      results,
    };
  }

  static async shareDiscussionToUsers(currentUserId, discussionId, recipientUserIds, message = '') {
    const discussion = await db.query.discussions.findFirst({
      where: eq(discussions.id, discussionId),
      with: {
        user: {
          columns: { id: true, username: true, name: true, image: true },
        },
      },
    });

    if (!discussion) throw new ApiError(404, 'Discussion not found');

    const uniqueRecipients = [...new Set(recipientUserIds)].filter(id => id !== currentUserId);
    if (uniqueRecipients.length === 0) throw new ApiError(400, 'No valid recipients provided');

    const results = [];

    for (const recipientId of uniqueRecipients) {
      try {
        const recipient = await db.query.users.findFirst({ where: eq(users.id, recipientId) });
        if (!recipient) {
          results.push({ userId: recipientId, success: false, error: 'User not found' });
          continue;
        }

        const conversation = await this.getOrCreateConversation(currentUserId, recipientId);
        const msg = await this.sendMessage(currentUserId, conversation.id, {
          messageType: 'discussion',
          content: message || 'Shared a discussion with you',
          metadata: {
            discussionId,
            sharedDiscussion: {
              id: discussion.id,
              title: discussion.title,
              description: discussion.description,
              mediaUrls: discussion.mediaUrls,
              groupId: discussion.groupId,
              user: discussion.user,
            },
          },
          discussionId,
        });

        results.push({
          userId: recipientId,
          success: true,
          conversationId: conversation.id,
          messageId: msg.id,
          message: msg,
        });
      } catch (error) {
        results.push({
          userId: recipientId,
          success: false,
          error: error.message || 'Failed to share discussion',
        });
      }
    }

    await db
      .update(discussions)
      .set({ sharesCount: sql`${discussions.sharesCount} + ${uniqueRecipients.length}` })
      .where(eq(discussions.id, discussionId));

    return {
      discussionId,
      totalRecipients: uniqueRecipients.length,
      successCount: results.filter(r => r.success).length,
      results,
    };
  }
}
