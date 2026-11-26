/**
 * Business inbox endpoints (see services/businessInbox.service.js).
 *
 * Live updates go out on the /chat socket namespace to each person's own
 * `user:<id>` room:
 *   business-inbox:message:new  { businessId, conversationId, side, message }
 *   business-inbox:read         { businessId, conversationId, side, readAt }
 * Business replies notify the customer, and customer messages notify the
 * business's inbox team (in-app + push), skipping anyone who has the thread
 * open — an open thread joins `business-inbox:conversation:<id>`.
 * The customer gets the customer view of a message; the team gets the
 * business view (which also says which team member sent it).
 */
import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';
import { emitSocialChat } from '../socket/emitter.js';
import { BusinessInboxService } from '../services/businessInbox.service.js';
import { PriorityMessageService } from '../services/priorityMessage.service.js';

const query = req => req.validatedQuery ?? req.query;

const deliverMessage = (req, conversation, side, sent) =>
  BusinessInboxService.broadcastMessage(req.app.get('io'), conversation, sent.business, side, sent);

async function deliverRead(req, conversation, business, read) {
  const io = req.app.get('io');
  if (!io) return;
  const payload = { businessId: business.id, ...read };
  // The reader's other tabs/devices and the other side both need it
  emitSocialChat(io, `user:${conversation.customerId}`, 'business-inbox:read', payload);
  for (const userId of await BusinessInboxService.inboxUserIds(business)) {
    emitSocialChat(io, `user:${userId}`, 'business-inbox:read', payload);
  }
}

/** Room an open thread joins (InboxThread.tsx) — only used to skip needless notifications. */
const threadRoom = conversationId => `business-inbox:conversation:${conversationId}`;

/** Which of `userIds` have this thread open right now (any of their sockets in its room). */
function usersViewing(io, conversationId, userIds) {
  const viewing = new Set();
  if (!io) return viewing;
  const rooms = io.of('/chat').adapter.rooms;
  const inThread = rooms.get(threadRoom(conversationId));
  if (!inThread) return viewing;
  for (const userId of userIds) {
    const userSockets = rooms.get(`user:${userId}`);
    if (userSockets && [...userSockets].some(sid => inThread.has(sid))) viewing.add(userId);
  }
  return viewing;
}
const customerIsViewing = (io, conversation) =>
  usersViewing(io, conversation.id, [conversation.customerId]).size > 0;

const deliverSafely = (label, fn) =>
  fn().catch(err => console.warn(`[businessInbox] ${label} socket delivery failed:`, err.message));

// ─── Customer side ──────────────────────────────────────────────────────────

export const openForCustomer = catchAsync(async (req, res) => {
  const data = await BusinessInboxService.openForCustomer(req.user, req.params.idOrSlug, req.body?.kind);
  res.json({ success: true, data });
});

export const listMine = catchAsync(async (req, res) => {
  const data = await BusinessInboxService.listForCustomer(req.user, query(req));
  res.json({ success: true, data });
});

export const unreadMine = catchAsync(async (req, res) => {
  const data = await BusinessInboxService.unreadForCustomer(req.user.id);
  res.json({ success: true, data });
});

export const getMyConversation = catchAsync(async (req, res) => {
  const conversation = await BusinessInboxService.getForCustomer(req.user, req.params.conversationId);
  const { business } = conversation;
  const data = await BusinessInboxService.listMessages(conversation, 'customer', req.user, query(req));
  res.json({
    success: true,
    data: {
      conversation: {
        id: conversation.id,
        businessId: conversation.businessId,
        kind: conversation.kind,
        lastMessageAt: conversation.lastMessageAt,
        businessLastReadAt: conversation.businessLastReadAt,
        business: { id: business.id, name: business.name, slug: business.slug, logoUrl: business.logoUrl ?? null },
      },
      ...data,
    },
  });
});

export const sendMine = catchAsync(async (req, res) => {
  const conversation = await BusinessInboxService.getForCustomer(req.user, req.params.conversationId);
  const sent = await BusinessInboxService.send(conversation, 'customer', req.user, req.body);
  // Paid thread: the talent's reply releases the business's priority payment.
  // Awaited first so the reply's response already reflects it (as in personal chat).
  if (conversation.kind === 'paid') {
    await PriorityMessageService.releaseOnBusinessReply(conversation.id, req.user.id, sent.customerMessage.id).catch(
      err => console.warn('[businessInbox] releaseOnBusinessReply failed (non-fatal):', err.message)
    );
  }
  res.status(httpStatus.CREATED).json({ success: true, data: { message: sent.customerMessage } });
  deliverSafely('send', () => deliverMessage(req, conversation, 'customer', sent));
  (async () => {
    const team = await BusinessInboxService.inboxUserIds(sent.business);
    await BusinessInboxService.notifyTeamOfCustomerMessage(conversation, sent, {
      viewingUserIds: usersViewing(req.app.get('io'), conversation.id, team),
    });
  })().catch(err => console.warn('[businessInbox] team notification failed:', err.message));
});

export const readMine = catchAsync(async (req, res) => {
  const conversation = await BusinessInboxService.getForCustomer(req.user, req.params.conversationId);
  const read = await BusinessInboxService.markRead(conversation, 'customer');
  res.json({ success: true, data: read });
  deliverSafely('read', () => deliverRead(req, conversation, conversation.business, read));
});

// ─── Business side (req.business / req.businessAccess from requireBusinessPermission) ──

export const listInbox = catchAsync(async (req, res) => {
  const data = await BusinessInboxService.listForBusiness(req.business, req.user, query(req));
  res.json({ success: true, data });
});

export const unreadInbox = catchAsync(async (req, res) => {
  const data = await BusinessInboxService.unreadForBusiness(req.business.id);
  res.json({ success: true, data });
});

export const openForBusiness = catchAsync(async (req, res) => {
  const data = await BusinessInboxService.openForBusiness(req.business, req.body.customerId, req.body.kind);
  res.json({ success: true, data });
});

export const getInboxConversation = catchAsync(async (req, res) => {
  const conversation = await BusinessInboxService.getForBusiness(req.business, req.params.conversationId);
  const data = await BusinessInboxService.listMessages(conversation, 'business', req.user, query(req));
  res.json({
    success: true,
    data: {
      conversation: {
        id: conversation.id,
        businessId: conversation.businessId,
        kind: conversation.kind,
        lastMessageAt: conversation.lastMessageAt,
        customerLastReadAt: conversation.customerLastReadAt,
        customer: conversation.customer ?? null,
      },
      ...data,
    },
  });
});

export const sendInbox = catchAsync(async (req, res) => {
  const conversation = await BusinessInboxService.getForBusiness(req.business, req.params.conversationId);
  const sent = await BusinessInboxService.send(conversation, 'business', req.user, req.body);
  res.status(httpStatus.CREATED).json({ success: true, data: { message: sent.businessMessage } });
  deliverSafely('send', () => deliverMessage(req, conversation, 'business', sent));
  BusinessInboxService.notifyCustomerOfReply(conversation, sent, {
    customerViewing: customerIsViewing(req.app.get('io'), conversation),
  }).catch(err => console.warn('[businessInbox] reply notification failed:', err.message));
});

export const readInbox = catchAsync(async (req, res) => {
  const conversation = await BusinessInboxService.getForBusiness(req.business, req.params.conversationId);
  const read = await BusinessInboxService.markRead(conversation, 'business');
  res.json({ success: true, data: read });
  deliverSafely('read', () => deliverRead(req, conversation, req.business, read));
});
