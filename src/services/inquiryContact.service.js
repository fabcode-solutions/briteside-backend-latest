/**
 * Inquiry messages (messageType 'inquiry') stay on Briteside: phone numbers,
 * emails and messaging-app links are hidden — in both directions — until the
 * customer has booked the business through Briteside. After that the two can
 * share contact details freely.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { businessBookings, businesses } from '../db/schema/index.js';
import { hideContactInfo } from '../utils/contactInfo.js';

// A real booking made on Briteside (not one still waiting for payment, or cancelled)
const UNLOCKING_STATUSES = ['pending', 'confirmed', 'completed'];

export class InquiryContactService {
  /** Has either user booked the other's business through Briteside? */
  static async isUnlocked(userId, otherUserId) {
    const [row] = await db
      .select({ id: businessBookings.id })
      .from(businessBookings)
      .innerJoin(businesses, eq(businesses.id, businessBookings.businessId))
      .where(
        and(
          eq(businessBookings.source, 'online'),
          inArray(businessBookings.status, UNLOCKING_STATUSES),
          or(
            and(eq(businesses.ownerId, userId), eq(businessBookings.customerId, otherUserId)),
            and(eq(businesses.ownerId, otherUserId), eq(businessBookings.customerId, userId))
          )
        )
      )
      .limit(1);
    return !!row;
  }

  /**
   * The inquiry's content + subject with contact details hidden (call only while
   * locked). `hidden` → the message's metadata is marked so the apps can say why.
   */
  static hide({ content, metadata }) {
    const body = hideContactInfo(content);
    const subject = hideContactInfo(metadata?.inquirySubject);
    const hidden = body.hidden || subject.hidden;
    const nextMeta = metadata ? { ...metadata } : metadata;
    if (subject.hidden) nextMeta.inquirySubject = subject.text;
    if (hidden) Object.assign((nextMeta ??= {}), { contactInfoHidden: true });
    return { content: body.text, metadata: nextMeta, hidden };
  }
}
