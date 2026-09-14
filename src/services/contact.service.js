import { db } from '../db/index.js';
import { contactMessages } from '../db/schema/contactMessages.js';
import { and, or, ilike, eq, desc, asc, sql } from 'drizzle-orm';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';

/**
 * Create and store a contact message
 * @param {Object} data
 */
export const createMessage = async data => {
  const { firstName, lastName, email, subject, message } = data;

  const [row] = await db
    .insert(contactMessages)
    .values({
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      email: email.toLowerCase().trim(),
      subject: subject.trim(),
      message: message.trim(),
      status: 'new',
    })
    .returning();

  TextModerationService.flagAsync({
    entityType: TEXT_ENTITY.SUPPORT,
    entityId: row.id,
    entityCreatorId: row.email,
    texts: [row.subject, row.message],
  });

  return row;
};

export const updateMessageStatus = async (id, updates) => {
  const [row] = await db
    .update(contactMessages) 
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(contactMessages.id, id))
    .returning();

  return row;
};

export const getMessageById = async id => {
  return db.query.contactMessages.findFirst({ where: eq(contactMessages.id, id) });
};

export const getMessages = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    status,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (status) conditions.push(eq(contactMessages.status, status));

  if (search) {
    const q = `%${search}%`;
    conditions.push(
      or(
        ilike(contactMessages.email, q),
        ilike(contactMessages.subject, q),
        ilike(contactMessages.message, q)
      )
    );
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(contactMessages)
    .where(whereClause || sql`true`);

  const orderColumn = contactMessages[sortBy] || contactMessages.createdAt;
  const orderDirection = sortOrder === 'asc' ? asc : desc;

  const rows = await db
    .select({
      id: contactMessages.id,
      firstName: contactMessages.firstName,
      lastName: contactMessages.lastName,
      email: contactMessages.email,
      subject: contactMessages.subject,
      message: contactMessages.message,
      status: contactMessages.status,
      createdAt: contactMessages.createdAt,
      updatedAt: contactMessages.updatedAt,
    })
    .from(contactMessages)
    .where(whereClause)
    .orderBy(orderDirection(orderColumn))
    .limit(limit)
    .offset(offset);

  return {
    data: rows,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  };
};

export const contactService = { createMessage, getMessages, getMessageById, updateMessageStatus };
