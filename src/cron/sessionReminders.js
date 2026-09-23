import { db } from '../db/index.js';
import { talentSessions } from '../db/schema/talentSessions.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import { talentReviews } from '../db/schema/talentReviews.js';
import { shopCustomServiceOffers } from '../db/schema/shop.js'
import { users } from '../db/schema/users.js';
import { eq, and, gte, lte, isNull, or } from 'drizzle-orm';
import { createNotification } from '../services/notification.service.js';
import * as mailService from '../services/mail.service.js';
import * as sessionEmails from './sessionEmails.js';
import { TalentSessionService } from '../services/talentSession.service.js';
import { sendBookingReminderEmail } from '../templates/index.js';
import { cronLogger as logger } from '../config/logger.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Join alert — in-app notification + frontend dialog trigger.
 * Fired for the 1h and 15m reminders (via sendReminderToBoth) and for the 1m
 * reminder (standalone), so the on-screen join dialog pops before the session.
 */
const sendJoinAlertToBoth = async (session, reminderType, preloadedParties = null) => {
  let booker, talentUser, talentName;

  if (preloadedParties) {
    ({ booker, talentUser, talentName } = preloadedParties);
  } else {
    try {
      const result = await TalentSessionService._getParties(session);
      booker = result.booker;
      talentUser = result.talentUser;
      talentName = result.talentName;
    } catch (err) {
      logger.error('[SessionReminder] Could not load parties for join alert', {
        sessionId: session.id,
        error: err.message,
        stack: err.stack,
      });
      return;
    }
  }

  const bookerName = `${booker.firstName} ${booker.lastName}`;
  const labelMap = {
    '1h': 'in 1 hour',
    '15m': 'in 15 minutes',
    '10m': 'in 10 minutes',
    '1m': 'in 1 minute',
  };
  const label = labelMap[reminderType] ?? 'soon';
  const baseMeta = {
    sessionId: session.id,
    reminderType,
    streamCallCid: session.streamCallCid,
    scheduledAt: session.scheduledAt,
  };

  await Promise.allSettled([
    createNotification({
      userId: session.bookerId,
      title: `Session starting ${label}`,
      message: `Your 1:1 with ${talentName} starts ${label}. Get ready to join!`,
      type: 'session_starting_soon',
      redirectTo: `/bookings`,
      relatedId: session.id,
      metadata: {
        ...baseMeta,
        actorUserId: talentUser.id,
        otherPerson: { name: talentName, image: talentUser.image ?? null },
      },
    }).catch(err =>
      logger.error('[SessionReminder] Join alert notif for booker failed', {
        sessionId: session.id,
        error: err.message,
      })
    ),
    createNotification({
      userId: talentUser.id,
      title: `Session starting ${label}`,
      message: `Your 1:1 with ${bookerName} starts ${label}. Get ready to join!`,
      type: 'session_starting_soon',
      redirectTo: `/bookings`,
      relatedId: session.id,
      metadata: {
        ...baseMeta,
        actorUserId: booker.id,
        otherPerson: { name: bookerName, image: booker.image ?? null },
      },
    }).catch(err =>
      logger.error('[SessionReminder] Join alert notification for talent failed', {
        sessionId: session.id,
        error: err.message,
      })
    ),
  ]);
};

/**
 * Core helper — send reminder email + in-app notification to both parties.
 * Errors are caught individually so one failure doesn't skip the other.
 */
const sendReminderToBoth = async (session, reminderType) => {
  let booker, talentUser, talentName;

  try {
    const result = await TalentSessionService._getParties(session);
    booker = result.booker;
    talentUser = result.talentUser;
    talentName = result.talentName;
  } catch (err) {
    logger.error('[SessionReminder] Could not load parties', {
      sessionId: session.id,
      error: err.message,
      stack: err.stack,
    });
    return;
  }

  const bookerName = `${booker.firstName} ${booker.lastName}`;
  const templates = {
    '24h': sessionEmails.reminder24h,
    '1h': sessionEmails.reminder1h,
    '15m': sessionEmails.reminder15m,
  };
  const emailFn = templates[reminderType];
  if (!emailFn) return;

  const labelMap = { '24h': 'in 24 hours', '1h': 'in 1 hour', '15m': 'in 15 minutes' };
  const label = labelMap[reminderType];
  const notifType = 'event_reminder';

  // 1h and 15m pop the on-screen join dialog (session_starting_soon), which IS
  // their in-app notification — so skip the generic event_reminder for them to
  // avoid a duplicate in-app notification. 24h has no dialog, so it keeps it.
  const isDialogType = reminderType === '1h' || reminderType === '15m';

  // ── Booker ────────────────────────────────────────────────────────────────
  if (!isDialogType) {
    try {
      await createNotification({
        userId: session.bookerId,
        title: `Session reminder — ${label}`,
        message: `Your 1:1 with ${talentName} starts ${label}.`,
        type: notifType,
        redirectTo: `/bookings`,
        relatedId: session.id,
        metadata: {
          sessionId: session.id,
          reminderType,
          actorUserId: talentUser.id,
        },
      });
    } catch (err) {
      logger.error('[SessionReminder] In-app notification for booker failed', {
        sessionId: session.id,
        error: err.message,
      });
    }
  }

  try {
    if (reminderType === '1h') {
      await sendBookingReminderEmail(booker.email, {
        user_name: booker.firstName,
        creator_name: talentName,
        session_time: dayjs(session.scheduledAt)
          .tz(booker.timezone || 'UTC')
          .format('h:mm A'),
        timezone: booker.timezone || 'UTC',
        duration: session.durationMins,
      });
    } else {
      const { subject, html } = emailFn(booker, talentName, session, booker.timezone || 'UTC');
      await mailService.sendMail(booker.email, subject, html);
    }
  } catch (err) {
    logger.error('[SessionReminder] Email to booker failed', {
      sessionId: session.id,
      error: err.message,
    });
  }

  // ── Talent ────────────────────────────────────────────────────────────────
  if (!isDialogType) {
    try {
      await createNotification({
        userId: talentUser.id,
        title: `Session reminder — ${label}`,
        message: `Your 1:1 with ${bookerName} starts ${label}.`,
        type: notifType,
        redirectTo: `/bookings`,
        relatedId: session.id,
        metadata: {
          sessionId: session.id,
          reminderType,
          actorUserId: booker.id,
        },
      });
    } catch (err) {
      logger.error('[SessionReminder] In-app notification for talent failed', {
        sessionId: session.id,
        error: err.message,
      });
    }
  }

  try {
    if (reminderType === '1h') {
      await sendBookingReminderEmail(talentUser.email, {
        user_name: talentUser.firstName,
        creator_name: bookerName,
        session_time: dayjs(session.scheduledAt)
          .tz(talentUser.timezone || 'UTC')
          .format('h:mm A'),
        timezone: talentUser.timezone || 'UTC',
        duration: session.durationMins,
      });
    } else {
      const { subject, html } = emailFn(
        talentUser,
        bookerName,
        session,
        talentUser.timezone || 'UTC'
      );
      await mailService.sendMail(talentUser.email, subject, html);
    }
  } catch (err) {
    logger.error('[SessionReminder] Email to talent failed', {
      sessionId: session.id,
      error: err.message,
    });
  }

  // Pop the on-screen join dialog for 1h and 15m reminders. This is the single
  // in-app notification for these timings (event_reminder is skipped above).
  if (isDialogType) {
    await sendJoinAlertToBoth(session, reminderType, { booker, talentUser, talentName });
  }
};

// ─── REMINDER PROCESSORS ──────────────────────────────────────────────────────

/**
 * Query sessions in a future time window and send reminders if not already sent.
 *
 * @param {number} minutesBefore - How far ahead to look (1440=24h, 60=1h, 15=15m)
 * @param {'24h'|'1h'|'15m'} reminderType
 * @param {string} sentAtField   - Column name to check/set (reminder24hSentAt etc.)
 * @param {number} windowMins    - Tolerance window in minutes (avoids duplicate sends)
 */
const processReminders = async (
  minutesBefore,
  reminderType,
  sentAtField,
  windowMins = 10,
  senderFn = sendReminderToBoth
) => {
  const now = new Date();
  const rangeStart = new Date(now.getTime() + (minutesBefore - windowMins) * 60_000);
  const rangeEnd = new Date(now.getTime() + minutesBefore * 60_000);

  logger.info('[SessionReminder] Processing reminders', { reminderType, minutesBefore });

  try {
    const sessions = await db.query.talentSessions.findMany({
      where: and(
        // Only confirmed sessions — pending sessions have no accepted call to join
        eq(talentSessions.status, 'confirmed'),
        // Starts within our window
        gte(talentSessions.scheduledAt, rangeStart),
        lte(talentSessions.scheduledAt, rangeEnd),
        // Reminder not already sent
        isNull(talentSessions[sentAtField])
      ),
    });

    if (sessions.length === 0) {
      logger.info('[SessionReminder] No reminders to send', { reminderType });
      return;
    }

    logger.info('[SessionReminder] Sending reminders', {
      reminderType,
      sessionCount: sessions.length,
    });

    for (const session of sessions) {
      try {
        await senderFn(session, reminderType);

        // Mark reminder as sent
        await db
          .update(talentSessions)
          .set({ [sentAtField]: now, updatedAt: now })
          .where(eq(talentSessions.id, session.id));

        logger.info('[SessionReminder] Reminder sent', { reminderType, sessionId: session.id });
      } catch (err) {
        logger.error('[SessionReminder] Failed for session', {
          sessionId: session.id,
          reminderType,
          error: err.message,
          stack: err.stack,
        });
      }
    }
  } catch (err) {
    logger.error('[SessionReminder] Query failed', {
      reminderType,
      error: err.message,
      stack: err.stack,
    });
  }
};

// ── Public exports (called by cronJobs.js) ────────────────────────────────────

export const processSessionReminders24h = () =>
  processReminders(1440, '24h', 'reminder24hSentAt', 30); // ±30 min window for hourly cron

export const processSessionReminders1h = () => processReminders(60, '1h', 'reminder1hSentAt', 10); // ±10 min window for 15-min cron

export const processSessionReminders15m = () => processReminders(15, '15m', 'reminder15mSentAt', 5); // ±5 min window for 5-min cron

// In-app join alert + dialog trigger. Run every minute via cron.
export const processSessionReminders1m = () =>
  processReminders(1, '1m', 'reminder1mSentAt', 2, sendJoinAlertToBoth);

/**
 * Check for confirmed sessions where talent never joined (grace = 10 min past scheduledAt).
 * Auto-cancels and issues refund notification.
 */
export const processNoShowCancellations = async () => {
  logger.info('[SessionReminder] Checking for no-show sessions');

  const now = new Date();
  const lookback = new Date(now.getTime() - 30 * 60_000); // sessions that started up to 30min ago

  try {
    const sessions = await db.query.talentSessions.findMany({
      where: and(
        eq(talentSessions.status, 'confirmed'),
        gte(talentSessions.scheduledAt, lookback),
        lte(talentSessions.scheduledAt, now),
        isNull(talentSessions.talentJoinedAt) // talent never joined
      ),
    });

    for (const session of sessions) {
      try {
        const result = await TalentSessionService.handleNoShow(session.id);
        if (result) {
          logger.info('[SessionReminder] Auto-cancelled no-show session', {
            sessionId: session.id,
          });
        }
      } catch (err) {
        logger.error('[SessionReminder] No-show handling failed', {
          sessionId: session.id,
          error: err.message,
          cause: err.cause?.message,
          stack: err.stack,
        });
      }
    }
  } catch (err) {
    logger.error('[SessionReminder] No-show query failed', {
      error: err.message,
      stack: err.stack,
    });
  }
};

/**
 * Auto-cancel pending sessions whose scheduledAt has passed.
 * Booker gets a full refund — talent never confirmed in time.
 */
export const processExpiredPendingSessions = async () => {
  logger.info('[SessionReminder] Checking for expired pending sessions');

  const now = dayjs.utc().toDate();

  try {
    const sessions = await db.query.talentSessions.findMany({
      where: and(eq(talentSessions.status, 'pending'), lte(talentSessions.scheduledAt, now)),
    });

    for (const session of sessions) {
      try {
        await TalentSessionService.autoExpirePending(session.id);
        logger.info('[SessionReminder] Auto-cancelled expired pending session', {
          sessionId: session.id,
        });
      } catch (err) {
        logger.error('[SessionReminder] Failed to auto-cancel expired pending session', {
          sessionId: session.id,
          error: err.message,
        });
      }
    }
  } catch (err) {
    logger.error('[SessionReminder] Expired pending sessions query failed', {
      error: err.message,
    });
  }
};

/**
 * Send a review reminder email to the booker 24h after session completion.
 * Skips if the booker has already submitted a review for that session.
 */
export const processReviewReminders = async () => {
  logger.info('[SessionReminder] Processing review reminders');

  const now = new Date();
  const rangeStart = new Date(now.getTime() - 25 * 60 * 60_000); // 25h ago
  const rangeEnd = new Date(now.getTime() - 23 * 60 * 60_000); // 23h ago

  try {
    const sessions = await db
      .select({
        id: talentSessions.id,
        bookerId: talentSessions.bookerId,
        talentProfileId: talentSessions.talentProfileId,
        scheduledAt: talentSessions.scheduledAt,
        subject: talentSessions.subject,
        priceCents: talentSessions.priceCents,
        durationMins: talentSessions.durationMins,
      })
      .from(talentSessions)
      .leftJoin(
        talentReviews,
        and(
          eq(talentReviews.sessionId, talentSessions.id),
          eq(talentReviews.reviewerId, talentSessions.bookerId)
        )
      )
      .where(
        and(
          eq(talentSessions.status, 'completed'),
          gte(talentSessions.billingEndedAt, rangeStart),
          lte(talentSessions.billingEndedAt, rangeEnd),
          isNull(talentSessions.reviewReminderSentAt),
          isNull(talentReviews.id) // no review submitted yet
        )
      );

    if (sessions.length === 0) {
      logger.info('[SessionReminder] No review reminders to send');
      return;
    }

    logger.info('[SessionReminder] Sending review reminders', { count: sessions.length });

    for (const session of sessions) {
      try {
        const { booker, talentUser, talentName } = await TalentSessionService._getParties(session);

        if (!booker?.email || !talentUser?.username) continue;

        const { subject, html } = sessionEmails.reviewReminder24h(
          booker,
          talentName,
          talentUser.username,
          session
        );
        await mailService.sendMail(booker.email, subject, html);

        await db
          .update(talentSessions)
          .set({ reviewReminderSentAt: now, updatedAt: now })
          .where(eq(talentSessions.id, session.id));

        logger.info('[SessionReminder] Review reminder sent', { sessionId: session.id });
      } catch (err) {
        logger.error('[SessionReminder] Review reminder failed', {
          sessionId: session.id,
          error: err.message,
          stack: err.stack,
        });
      }
    }
   } catch (err) {
    logger.error('[SessionReminder] processReviewReminders query failed', {
      error: err.message,
      stack: err.stack,
    });
  }
};

/**
 * Send a review reminder email to the buyer 24h after a custom offer is
 * marked completed. Skips if the buyer has already submitted a review for
 * that offer. Mirrors processReviewReminders but sourced from
 * shop_custom_service_offers instead of talent_sessions.
 */
export const processCustomOfferReviewReminders = async () => {
  logger.info('[SessionReminder] Processing custom offer review reminders');

  const now = new Date();
  const rangeStart = new Date(now.getTime() - 25 * 60 * 60_000); // 25h ago
  const rangeEnd = new Date(now.getTime() - 23 * 60 * 60_000); // 23h ago

  try {
    const offers = await db
      .select({
        id: shopCustomServiceOffers.id,
        buyerId: shopCustomServiceOffers.buyerId,
        sellerId: shopCustomServiceOffers.sellerId,
        title: shopCustomServiceOffers.title,
        completedAt: shopCustomServiceOffers.completedAt,
      })
      .from(shopCustomServiceOffers)
      .leftJoin(
        talentReviews,
        and(
          eq(talentReviews.shopCustomOfferId, shopCustomServiceOffers.id),
          eq(talentReviews.reviewerId, shopCustomServiceOffers.buyerId)
        )
      )
      .where(
        and(
          eq(shopCustomServiceOffers.status, 'completed'),
          gte(shopCustomServiceOffers.completedAt, rangeStart),
          lte(shopCustomServiceOffers.completedAt, rangeEnd),
          isNull(shopCustomServiceOffers.reviewReminderSentAt),
          isNull(talentReviews.id) // no review submitted yet
        )
      );

    if (offers.length === 0) {
      logger.info('[SessionReminder] No custom offer review reminders to send');
      return;
    }

    logger.info('[SessionReminder] Sending custom offer review reminders', {
      count: offers.length,
    });

    for (const offer of offers) {
      try {
        const [buyer, seller] = await Promise.all([
          db.query.users.findFirst({ where: eq(users.id, offer.buyerId) }),
          db.query.users.findFirst({ where: eq(users.id, offer.sellerId) }),
        ]);

        if (!buyer?.email || !seller?.username) continue;

        const sellerName = `${seller.firstName} ${seller.lastName}`;

        // Reuses the session review-reminder template — same "leave a
        // review for X" shape works for a completed project as-is.
        const { subject, html } = sessionEmails.reviewReminder24h(buyer, sellerName, seller.username, {
          id: offer.id,
          subject: offer.title,
        });
        await mailService.sendMail(buyer.email, subject, html);

        await db
          .update(shopCustomServiceOffers)
          .set({ reviewReminderSentAt: now, updatedAt: now })
          .where(eq(shopCustomServiceOffers.id, offer.id));

        logger.info('[SessionReminder] Custom offer review reminder sent', { offerId: offer.id });
      } catch (err) {
        logger.error('[SessionReminder] Custom offer review reminder failed', {
          offerId: offer.id,
          error: err.message,
          stack: err.stack,
        });
      }
    }
  } catch (err) {
    logger.error('[SessionReminder] processCustomOfferReviewReminders query failed', {
      error: err.message,
      stack: err.stack,
    });
  }
};

/**
 * Auto-end sessions that have exceeded their booked duration.
 * Runs every 5 minutes. Only fires if billingStartedAt is set.
 */
export const processAutoEndSessions = async () => {
  logger.info('[SessionReminder] Checking for sessions to auto-end');

  const now = new Date();

  try {
    // Fetch all live sessions — can't do the math purely in SQL easily
    const liveSessions = await db.query.talentSessions.findMany({
      where: eq(talentSessions.status, 'live'),
    });

    for (const session of liveSessions) {
      if (!session.billingStartedAt) continue;

      const expectedEnd = new Date(
        new Date(session.billingStartedAt).getTime() + session.durationMins * 60_000
      );

      if (now >= expectedEnd) {
        try {
          await TalentSessionService.endSession(session.id);
          logger.info('[SessionReminder] Auto-ended session', { sessionId: session.id });
        } catch (err) {
          logger.error('[SessionReminder] Auto-end failed', {
            sessionId: session.id,
            error: err.message,
            stack: err.stack,
          });
        }
      }
    }

    // Confirmed sessions whose scheduled window closed without a call ever
    // starting (billingStartedAt never set, so they never reached 'live')
    // otherwise sat at 'confirmed' forever — nothing else ever closes these
    // out once their scheduled end time has passed.
    const confirmedSessions = await db.query.talentSessions.findMany({
      where: eq(talentSessions.status, 'confirmed'),
    });

    for (const session of confirmedSessions) {
      const scheduledEnd = new Date(
        new Date(session.scheduledAt).getTime() + session.durationMins * 60_000
      );
      if (now >= scheduledEnd) {
        try {
          await TalentSessionService.endSession(session.id);
          logger.info('[SessionReminder] Auto-ended never-started session', {
            sessionId: session.id,
          });
        } catch (err) {
          logger.error('[SessionReminder] Auto-end (never-started) failed', {
            sessionId: session.id,
            error: err.message,
            stack: err.stack,
          });
        }
      }
    }
  } catch (err) {
    logger.error('[SessionReminder] Auto-end query failed', {
      error: err.message,
      stack: err.stack,
    });
  }
};
