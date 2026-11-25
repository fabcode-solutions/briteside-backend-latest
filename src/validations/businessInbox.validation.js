import { z } from 'zod';
import { MESSAGE_TYPES } from '../utils/businessInbox.js';

const uuid = z.string().uuid();
const idOrSlug = z.string().trim().min(1).max(120);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const messagesQuery = z.object({
  before: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Shape only — content rules per type live in utils/businessInbox.js
const messageBody = z.object({
  messageType: z.enum(MESSAGE_TYPES).optional(),
  content: z.string().max(4096).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─── Customer ───────────────────────────────────────────────────────────────
export const openForCustomerSchema = z.object({ params: z.object({ idOrSlug }) });
export const listMineSchema = z.object({ query: listQuery });
export const myConversationSchema = z.object({
  params: z.object({ conversationId: uuid }),
  query: messagesQuery,
});
export const sendMineSchema = z.object({
  params: z.object({ conversationId: uuid }),
  body: messageBody,
});
export const readMineSchema = z.object({ params: z.object({ conversationId: uuid }) });

// ─── Business ───────────────────────────────────────────────────────────────
export const listInboxSchema = z.object({
  params: z.object({ businessId: uuid }),
  query: listQuery.extend({
    unread: z
      .enum(['true', 'false'])
      .transform(v => v === 'true')
      .optional(),
  }),
});
export const unreadInboxSchema = z.object({ params: z.object({ businessId: uuid }) });
export const openForBusinessSchema = z.object({
  params: z.object({ businessId: uuid }),
  body: z.object({ customerId: uuid }),
});
export const inboxConversationSchema = z.object({
  params: z.object({ businessId: uuid, conversationId: uuid }),
  query: messagesQuery,
});
export const sendInboxSchema = z.object({
  params: z.object({ businessId: uuid, conversationId: uuid }),
  body: messageBody,
});
export const readInboxSchema = z.object({
  params: z.object({ businessId: uuid, conversationId: uuid }),
});
