/**
 * Businesses that take inquiries by email: a new inquiry from their page
 * (an 'inquiry' message carrying metadata.businessId) is emailed to their
 * inquiry address. The email holds the already-moderated text (contact details
 * hidden) and links back to the conversation — the customer's email address is
 * never shared, and the business replies on Briteside.
 */
import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businesses, businessMessages, socialMessages, users } from '../db/schema/index.js';
import logger from '../config/logger.js';
import { sendMail } from './mail.service.js';
import { emailWrapper, ctaRow, ctaButton, appUrl } from '../templates/emailLayout.js';

/** Anti-spam: inquiry emails one customer can trigger per conversation per hour. */
const EMAILS_PER_HOUR = 5;

const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function emailInquiryIfNeeded({ senderId, recipientId, conversationId, content, metadata }) {
  const businessId = metadata?.businessId;
  if (typeof businessId !== 'string' || !/^[0-9a-f-]{36}$/i.test(businessId)) return;

  // Only the business the customer is actually messaging (metadata comes from the client)
  const business = await db.query.businesses.findFirst({
    where: and(eq(businesses.id, businessId), eq(businesses.ownerId, recipientId), isNull(businesses.deletedAt)),
    columns: { id: true, name: true, email: true, inquiryChannel: true, inquiryEmail: true },
  });
  const to = business?.inquiryEmail || business?.email;
  if (!business || business.inquiryChannel !== 'email' || !to) return;

  const [{ recent }] = await db
    .select({ recent: count() })
    .from(socialMessages)
    .where(
      and(
        eq(socialMessages.conversationId, conversationId),
        eq(socialMessages.senderId, senderId),
        eq(socialMessages.messageType, 'inquiry'),
        gte(socialMessages.createdAt, new Date(Date.now() - 3_600_000))
      )
    );
  if (recent > EMAILS_PER_HOUR) return;

  await sendInquiryEmail({
    to,
    business,
    senderId,
    content,
    metadata,
    replyUrl: appUrl('/messages', { tab: 'inquiry', conversationId }),
  });
}

/**
 * Business inbox (business_conversations): a customer's inquiry is emailed to
 * the business when it takes inquiries by email. The reply link opens the
 * thread in the business inbox, never anyone's personal messages.
 */
export async function emailBusinessInboxInquiry({ business, senderId, conversationId, content, metadata }) {
  const to = business?.inquiryEmail || business?.email;
  if (!business || business.inquiryChannel !== 'email' || !to) return;

  const [{ recent }] = await db
    .select({ recent: count() })
    .from(businessMessages)
    .where(
      and(
        eq(businessMessages.conversationId, conversationId),
        eq(businessMessages.senderSide, 'customer'),
        eq(businessMessages.messageType, 'inquiry'),
        gte(businessMessages.createdAt, new Date(Date.now() - 3_600_000))
      )
    );
  if (recent > EMAILS_PER_HOUR) return;

  await sendInquiryEmail({
    to,
    business,
    senderId,
    content,
    metadata,
    replyUrl: appUrl('/business/inbox', { conversationId }),
  });
}

export function queueBusinessInboxInquiryEmail(args) {
  emailBusinessInboxInquiry(args).catch(err =>
    logger.error(`[businessInquiry] inbox email failed: ${err.message}`)
  );
}

async function sendInquiryEmail({ to, business, senderId, content, metadata, replyUrl }) {
  const sender = await db.query.users.findFirst({
    where: eq(users.id, senderId),
    columns: { firstName: true, lastName: true, username: true },
  });
  const from =
    [sender?.firstName, sender?.lastName].map(s => (s ?? '').trim()).filter(Boolean).join(' ') ||
    sender?.username ||
    'A Briteside member';
  const subject = String(metadata?.inquirySubject ?? '').trim() || 'New inquiry';

  await sendMail(
    to,
    `New inquiry for ${business.name}: ${subject}`,
    emailWrapper(`
      <h2 style="margin:0 0 12px">New inquiry for ${escapeHtml(business.name)}</h2>
      <p><strong>${escapeHtml(from)}</strong> sent you an inquiry on Briteside.</p>
      <p style="margin:16px 0 4px"><strong>${escapeHtml(subject)}</strong></p>
      <p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(content)}</p>
      ${ctaRow(ctaButton('Reply on Briteside', replyUrl))}
      <p style="color:#6b7280;font-size:13px">Replying to this email won't reach the customer — reply on Briteside.
      Contact details stay hidden until the customer books through Briteside.</p>
    `),
    `New inquiry for ${business.name} from ${from}\n\n${subject}\n\n${content}\n\nReply on Briteside: ${replyUrl}`
  );
}

/** Fire-and-forget wrapper: a failed email never fails sending the message. */
export function queueInquiryEmail(args) {
  emailInquiryIfNeeded(args).catch(err => logger.error(`[businessInquiry] email failed: ${err.message}`));
}
