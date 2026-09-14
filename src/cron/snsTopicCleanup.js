import { db } from '../db/index.js';
import { events } from '../db/schema/index.js';
import { and, lt, isNotNull, eq } from 'drizzle-orm';
import { deleteEventTopic } from '../utils/aws.util.js';
import { cronLogger as logger } from '../config/logger.js';

export const cleanupExpiredEventTopics = async () => {
  const now = new Date();

  const expiredEvents = await db
    .select({ id: events.id, snsTopicArn: events.snsTopicArn })
    .from(events)
    .where(and(lt(events.endDate, now), isNotNull(events.snsTopicArn)));

  if (expiredEvents.length === 0) return;

  logger.info('[Cron] SNS cleanup: found expired event topics', { count: expiredEvents.length });

  for (const event of expiredEvents) {
    try {
      await deleteEventTopic(event.snsTopicArn);
      await db.update(events).set({ snsTopicArn: null }).where(eq(events.id, event.id));
      logger.info('[Cron] SNS cleanup: deleted topic', { eventId: event.id });
    } catch (err) {
      logger.error('[Cron] SNS cleanup: failed for event', {
        eventId: event.id,
        error: err.message,
        stack: err.stack,
      });
    }
  }
};
