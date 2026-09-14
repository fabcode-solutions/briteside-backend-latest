import { db } from '../db/index.js';
import { eventBlasts, purchasedTickets, users, events } from '../db/schema/index.js';
import { eq, and, count } from 'drizzle-orm';
import { sendSMS, sendEventBlast } from '../utils/aws.util.js';
import { sendMail } from './mail.service.js';
import ApiError from '../utils/api-error.js';

const DAILY_LIMITS = { sms: 2, email: 2 };
const MAX_RECIPIENTS = 1000;
const SEND_BATCH_SIZE = 10;

async function checkRateLimit(eventId, type) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(eventBlasts)
    .where(and(eq(eventBlasts.eventId, eventId), eq(eventBlasts.type, type)));
  if (value >= DAILY_LIMITS[type]) {
    throw new ApiError(
      429,
      `${type.toUpperCase()} blast limit (${DAILY_LIMITS[type]} total) reached for this event.`
    );
  }
}

async function getAttendees(eventId) {
  return db
    .selectDistinctOn([purchasedTickets.userId], {
      userId: purchasedTickets.userId,
      email: users.email,
      phoneNumber: users.phoneNumber,
      firstName: users.firstName,
    })
    .from(purchasedTickets)
    .innerJoin(users, eq(purchasedTickets.userId, users.id))
    .where(and(eq(purchasedTickets.eventId, eventId), eq(purchasedTickets.status, 'active')))
    .limit(MAX_RECIPIENTS);
}

async function dispatchInBatches(items, sendFn) {
  let success = 0;
  let failure = 0;
  for (let i = 0; i < items.length; i += SEND_BATCH_SIZE) {
    const batch = items.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(sendFn));
    for (const r of results) {
      if (r.status === 'fulfilled') success++;
      else failure++;
    }
  }
  return { success, failure };
}

export class BlastService {
  static async sendSmsBlast({ eventId, message, sentBy, sentByTeamMember }) {
    await checkRateLimit(eventId, 'sms');

    const eventRow = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { snsTopicArn: true },
    });

    const attendees = await getAttendees(eventId);
    const eligible = attendees.filter(a => a.phoneNumber);

    const [blast] = await db
      .insert(eventBlasts)
      .values({
        eventId,
        sentBy: sentBy || null,
        sentByTeamMember: sentByTeamMember || null,
        type: 'sms',
        message,
        recipientCount: eligible.length,
        status: 'pending',
      })
      .returning();

    let success = 0;
    let failure = 0;

    if (eventRow?.snsTopicArn) {
      try {
        await sendEventBlast(eventRow.snsTopicArn, message);
        success = eligible.length;
      } catch {
        failure = eligible.length;
      }
    } else {
      ({ success, failure } = await dispatchInBatches(eligible, a =>
        sendSMS(a.phoneNumber, message)
      ));
    }

    const [updated] = await db
      .update(eventBlasts)
      .set({ successCount: success, failureCount: failure, status: 'completed' })
      .where(eq(eventBlasts.id, blast.id))
      .returning();

    return updated;
  }

  static async sendEmailBlast({ eventId, subject, message, sentBy, sentByTeamMember }) {
    await checkRateLimit(eventId, 'email');

    const attendees = await getAttendees(eventId);
    const eligible = attendees.filter(a => a.email);

    const eventRow = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { title: true },
    });

    const resolvedSubject = subject || `Update from ${eventRow?.title || 'your event'}`;

    const [blast] = await db
      .insert(eventBlasts)
      .values({
        eventId,
        sentBy: sentBy || null,
        sentByTeamMember: sentByTeamMember || null,
        type: 'email',
        subject: resolvedSubject,
        message,
        recipientCount: eligible.length,
        status: 'pending',
      })
      .returning();

    const { success, failure } = await dispatchInBatches(eligible, a =>
      sendMail(
        a.email,
        resolvedSubject,
        `<p>Hi ${a.firstName || 'there'},</p><p>${message}</p>`,
        message
      )
    );

    const [updated] = await db
      .update(eventBlasts)
      .set({ successCount: success, failureCount: failure, status: 'completed' })
      .where(eq(eventBlasts.id, blast.id))
      .returning();

    return updated;
  }

  static async listBlasts(eventId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    return db.query.eventBlasts.findMany({
      where: eq(eventBlasts.eventId, eventId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit,
      offset,
    });
  }

  static async getBlastStats(eventId) {
    const rows = await db
      .select({ type: eventBlasts.type, value: count() })
      .from(eventBlasts)
      .where(eq(eventBlasts.eventId, eventId))
      .groupBy(eventBlasts.type);

    const used = Object.fromEntries(rows.map(r => [r.type, Number(r.value)]));
    return {
      sms: { used: used.sms || 0, limit: DAILY_LIMITS.sms },
      email: { used: used.email || 0, limit: DAILY_LIMITS.email },
    };
  }
}
