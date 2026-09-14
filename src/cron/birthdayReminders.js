import { db } from '../db/index.js';
import { users, userFollows } from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { createNotification } from '../services/notification.service.js';
import { SocialChatService } from '../services/socialChat.service.js';
import { cronLogger as logger } from '../config/logger.js';

/**
 * Find all users whose birthday is today (month + day match, ignoring year)
 * and send notifications to all their followers.
 */
export const processBirthdayNotifications = async () => {
  logger.info('[Cron] Processing birthday notifications');

  try {
    // Find users with dob matching today's month and day
    const birthdayUsers = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(users)
      .where(
        and(
          sql`EXTRACT(MONTH FROM ${users.dob}) = EXTRACT(MONTH FROM CURRENT_DATE)`,
          sql`EXTRACT(DAY FROM ${users.dob}) = EXTRACT(DAY FROM CURRENT_DATE)`,
          sql`${users.deletedAt} IS NULL`,
          sql`${users.dob} IS NOT NULL`
        )
      );

    logger.info('[Cron] Birthday users found', { count: birthdayUsers.length });

    for (const birthdayUser of birthdayUsers) {
      const displayName =
        birthdayUser.username || `${birthdayUser.firstName} ${birthdayUser.lastName}`.trim();

      // Get all followers of this birthday user
      const followers = await db
        .select({ followerId: userFollows.followerId })
        .from(userFollows)
        .where(eq(userFollows.followingId, birthdayUser.id));

      logger.info('[Cron] Sending birthday notifications', {
        displayName,
        followerCount: followers.length,
      });

      for (const { followerId } of followers) {
        try {
          // Get or create conversation between follower and birthday user
          const conversation = await SocialChatService.getOrCreateConversation(
            followerId,
            birthdayUser.id
          );

          await createNotification({
            userId: followerId,
            title: '🎂 Birthday Today!',
            message: `It's ${displayName}'s birthday today! Send them your wishes.`,
            type: 'birthday_notification',
            relatedId: birthdayUser.id,
            redirectTo: `/messages?conversationId=${conversationId}&tab=general`,
            metadata: {
              birthdayUserId: birthdayUser.id,
              birthdayUsername: birthdayUser.username,
              conversationId: conversation.id,
              actorUserId: birthdayUser.id,
            },
          });
        } catch (error) {
          logger.error('[Cron] Birthday notification failed', {
            followerId,
            error: error.message,
            stack: error.stack,
          });
        }
      }
    }

    logger.info('[Cron] Birthday notifications complete');
  } catch (error) {
    logger.error('[Cron] Birthday notifications failed', {
      error: error.message,
      stack: error.stack,
    });
  }
};

export default { processBirthdayNotifications };
