import cron from 'node-cron';
import { cronLogger as logger } from '../config/logger.js';
import { cleanupExpiredEventTopics } from './snsTopicCleanup.js';
import { processEventReminders, sendPromotionalEmailsToNonAttendees } from './eventReminders.js';
import { cleanupDeletedFiles, cleanupOrphanedReferences } from './fileCleanup.js';
import { cleanupExpiredStatusPosts } from './statusPostCleanup.js';
import { processBirthdayNotifications } from './birthdayReminders.js';
import {
  processSessionReminders24h,
  processSessionReminders1h,
  processSessionReminders15m,
  processSessionReminders1m,
  processNoShowCancellations,
  processAutoEndSessions,
  processReviewReminders,
  processExpiredPendingSessions,
  processCustomOfferReviewReminders,
} from './sessionReminders.js';
import { runReserveRelease } from './reserveRelease.js';
import { startPriorityMessageRefundCron } from './priorityMessageRefund.js';
import { publishScheduledPosts } from './publishScheduledPosts.js';
import { cleanupStaleImports } from './cleanupStaleImports.js';
import { sweepMissingConnectAccounts } from './connectAccountSweep.js';
import { reconcileStuckModeration } from './reconcileModeration.js';
import { cleanupExpiredEventChats } from './eventChatCleanup.cron.js';
import { refreshFromS3IfNewer } from '../services/urlModeration/scheduler.js';
import { processCustomOfferAutoApprove } from './customOfferAutoApprove.js';
import { ensureAnalyticsPartitions } from './analyticsPartitionMaintenance.cron.js';
import { runAnalyticsRollup } from './analyticsRollup.cron.js';
// Wraps a cron callback — catches any top-level uncaught throw and logs it.
const runCron = (name, fn) => async () => {
  try {
    await fn();
  } catch (err) {
    logger.error('[Cron] Uncaught error', { job: name, error: err.message, stack: err.stack });
  }
};

/**
 * Initialize all cron jobs for the application
 */
export const initializeCronJobs = () => {
  logger.info('[Cron] Initializing cron jobs');

  // Run every hour to check for 24-hour reminders
  cron.schedule(
    '0 * * * *',
    runCron('eventReminders24h', () => processEventReminders(24))
  );

  // Run every 2 hours to check for 6-hour reminders
  cron.schedule(
    '0 */2 * * *',
    runCron('eventReminders6h', () => processEventReminders(6))
  );

  // Run weekly on Sundays at 10 AM to send promotional emails to non-attendees
  cron.schedule('0 10 * * 0', runCron('promotionalEmails', sendPromotionalEmailsToNonAttendees));

  // Run daily at 3 AM to clean up deleted files (30-day grace period)
  cron.schedule('0 3 * * *', runCron('fileCleanup', cleanupDeletedFiles));

  cron.schedule('45 * * * *', runCron('eventChatCleanup', cleanupExpiredEventChats));

  // Run weekly on Mondays at 4 AM to clean up orphaned file references
  cron.schedule('0 4 * * 1', runCron('orphanedRefsCleanup', cleanupOrphanedReferences));

  // Run every hour to hard-delete expired status posts and clear their profile reference
  cron.schedule('30 * * * *', runCron('statusPostCleanup', cleanupExpiredStatusPosts));

  // Run daily at 8 AM to send birthday notifications to followers
  cron.schedule('0 8 * * *', runCron('birthdayNotifications', processBirthdayNotifications));

  // 24h reminder — runs every hour
  cron.schedule('0 * * * *', runCron('sessionReminders24h', processSessionReminders24h));

  // 1h reminder — runs every 15 minutes. Sends email + pops join dialog.
  cron.schedule('*/15 * * * *', runCron('sessionReminders1h', processSessionReminders1h));

  // 15min reminder — runs every 5 minutes. Sends email + pops join dialog.
  cron.schedule('*/5 * * * *', runCron('sessionReminders15m', processSessionReminders15m));

  // No-show cancellation check — runs every 5 minutes
  cron.schedule('*/5 * * * *', runCron('noShowCancellations', processNoShowCancellations));

  // Auto-cancel pending sessions whose scheduled time has passed — runs every 5 minutes
  cron.schedule('*/5 * * * *', runCron('expiredPendingSessions', processExpiredPendingSessions));

  // Auto-end live sessions that have exceeded their booked duration
  cron.schedule('*/5 * * * *', runCron('autoEndSessions', processAutoEndSessions));

  // 24h post-session review reminder — runs every hour
  cron.schedule('0 * * * *', runCron('reviewReminders', processReviewReminders));

  // 24h post-custom-offer-completion review reminder — runs every hour
  cron.schedule(
    '0 * * * *',
    runCron('customOfferReviewReminders', processCustomOfferReviewReminders)
  );

  cron.schedule('0 * * * *', runCron('customOfferAutoApprove', processCustomOfferAutoApprove));

  // Every 10 days at 2 AM — delete SNS topics for events whose end date has passed
  cron.schedule('0 2 */10 * *', runCron('snsTopicCleanup', cleanupExpiredEventTopics));

  // Daily at 1 AM — release held reserves back to organizers after hold window
  cron.schedule('0 1 * * *', runCron('reserveRelease', runReserveRelease));

  // Every 30 minutes — refund unanswered priority messages past 48h
  startPriorityMessageRefundCron();

  // Every minute — publish scheduled posts + 1m session join alert/dialog
  cron.schedule('* * * * *', runCron('publishScheduledPosts', publishScheduledPosts));
  cron.schedule(
    '* * * * *',
    runCron('sessionJoinAlerts', () => processSessionReminders1m())
  );

  // Every hour — delete abandoned draft imports older than 2hrs and their S3 objects
  cron.schedule('0 * * * *', runCron('staleImportsCleanup', cleanupStaleImports));

  // Every 6 hours — retry Stripe Connect account creation for talents/organizers
  // whose fire-and-forget create silently failed (network blip, Stripe outage)
  cron.schedule('0 */6 * * *', runCron('connectAccountSweep', sweepMissingConnectAccounts));

  // Every 30 minutes — re-queue moderation checks stuck 'pending' (dropped webhook / dead job)
  cron.schedule('*/30 * * * *', runCron('reconcileModeration', reconcileStuckModeration));

  // Every 10 minutes — cheap check of the S3 blocklist pointer; only pulls the
  // full snapshot when another instance has published a newer version.
  cron.schedule('*/10 * * * *', runCron('urlModerationRefresh', refreshFromS3IfNewer));

  // Daily at 2:30 AM — pre-create upcoming monthly partitions for analytics_events
  cron.schedule('30 2 * * *', runCron('analyticsPartitionMaintenance', ensureAnalyticsPartitions));

  // Every 10 minutes — roll raw analytics_events up into the *_analytics_daily tables
  cron.schedule('*/10 * * * *', runCron('analyticsRollup', runAnalyticsRollup));

  logger.info('[Cron] All cron jobs initialized');
};

/**
 * Manual trigger for testing cron jobs
 * @param {number} hoursBefore - Hours before event
 * @param {string} eventId - Specific event ID (optional)
 * @param {string} action - Action type: 'reminders', 'promotional', 'bulk'
 */
export const triggerCronJobs = async (hoursBefore = 24, eventId = null, action = 'promotional') => {
  if (action === 'promotional') {
    logger.info('[Cron] Manually triggering promotional emails');
    await sendPromotionalEmailsToNonAttendees();
  } else if (action === 'bulk') {
    logger.info('[Cron] Manually triggering bulk purchase analysis');
    // Could implement bulk analysis here
  } else {
    if (eventId) {
      logger.info('[Cron] Manually triggering reminders for event', { hoursBefore, eventId });
      // Implementation for specific event
    } else {
      logger.info('[Cron] Manually triggering reminders for all upcoming events', { hoursBefore });
      await processEventReminders(hoursBefore);
    }
  }
};

export default {
  initializeCronJobs,
  triggerCronJobs,
};
