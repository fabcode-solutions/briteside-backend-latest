import { db } from '../config/database.js';
import {
  businesses,
  events,
  livestreams,
  groups,
  groupMembers,
  notifications,
  organizers,
  posts,
  stories,
  talentProfiles,
  talentSessions,
  userNotificationSettings,
} from '../db/schema/index.js';
import { eq, desc, and, gte, inArray, sql } from 'drizzle-orm';

const NOTIFICATION_RETENTION_DAYS = 30;
import { getIO } from '../utils/io.js';
import { emitNotification } from '../socket/emitter.js';
import { getActorProfiles } from '../utils/helper.js';
import logger from '../config/logger.js';
import { sendPushForNotification } from './push.service.js';

const typeToSetting = {
  event_update: 'eventUpdates',
  purchase_confirmation: 'purchaseConfirmation',
  event_reminder: 'eventReminders',
  chat_message: 'chatMessages',
  group_activity: 'groupActivities',
  social_update: 'socialUpdates',
  birthday_notification: 'birthdayNotifications',
};

const actorMetadataKeys = [
  'actorUserId',
  'senderId',
  'requesterId',
  'followerId',
  'inviterId',
  'commenterId',
  'likerId',
  'mentionedByUserId',
  'removedBy',
  'broadcasterId',
  'creatorId',
  'targetUserId',
  'birthdayUserId',
  'reviewerId',
];

const getActorIdFromMetadata = metadata => {
  for (const key of actorMetadataKeys) {
    if (metadata?.[key]) return metadata[key];
  }
  return null;
};

const withActorProfile = (notification, profileMap) => {
  const actorUserId = getActorIdFromMetadata(notification.metadata);
  const profile = actorUserId ? (profileMap[actorUserId] ?? null) : null;
  const organizerLogoUrl = notification.metadata?.organizerLogoUrl ?? null;

  let actorProfile = null;
  if (profile) {
    actorProfile = organizerLogoUrl ? { ...profile, profileImage: organizerLogoUrl } : profile;
  } else if (organizerLogoUrl) {
    actorProfile = { profileImage: organizerLogoUrl };
  }

  return { ...notification, actorProfile };
};

const enrichNotifications = async notificationRows => {
  const actorIds = [
    ...new Set(notificationRows.map(n => getActorIdFromMetadata(n.metadata)).filter(Boolean)),
  ];
  const profileMap = await getActorProfiles(actorIds);
  return notificationRows.map(notification => withActorProfile(notification, profileMap));
};

const resolveGroupActorId = async groupId => {
  if (!groupId) return null;

  const group = await db.query.groups.findFirst({
    where: eq(groups.id, groupId),
    columns: { createdBy: true },
  });
  if (group?.createdBy) return group.createdBy;

  const admin = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'admin')),
    columns: { userId: true },
  });

  return admin?.userId ?? null;
};

const resolveEventActorId = async eventId => {
  if (!eventId) return null;

  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: { organizerId: true, groupId: true },
  });
  if (!event) return null;

  if (event.groupId) {
    const groupActorId = await resolveGroupActorId(event.groupId);
    if (groupActorId) return groupActorId;
  }

  const organizer = await db.query.organizers.findFirst({
    where: eq(organizers.id, event.organizerId),
    columns: { userId: true },
  });

  return organizer?.userId ?? null;
};

const resolveSessionActorId = async (sessionId, recipientUserId) => {
  if (!sessionId) return null;

  const session = await db.query.talentSessions.findFirst({
    where: eq(talentSessions.id, sessionId),
    columns: { bookerId: true, talentProfileId: true },
  });
  if (!session) return null;

  const profile = await db.query.talentProfiles.findFirst({
    where: eq(talentProfiles.id, session.talentProfileId),
    columns: { userId: true },
  });

  const talentUserId = profile?.userId;
  if (!talentUserId) return null;

  return recipientUserId === session.bookerId ? talentUserId : session.bookerId;
};

const resolveActorUserId = async data => {
  const metadata = data.metadata ?? {};
  const metadataActorId = getActorIdFromMetadata(metadata);
  if (metadataActorId) return metadataActorId;

  if (data.type === 'event_reminder') return null;

  const sessionActorId = await resolveSessionActorId(
    metadata.sessionId ?? data.relatedId,
    data.userId
  );
  if (sessionActorId) return sessionActorId;

  if ('organizerLogoUrl' in metadata) return null;

  const eventActorId = await resolveEventActorId(metadata.eventId ?? data.relatedId);
  if (eventActorId) return eventActorId;

  const groupActorId = await resolveGroupActorId(metadata.groupId ?? data.relatedId);
  if (groupActorId) return groupActorId;

  return null;
};

const addResolvedActorMetadata = async data => {
  const actorUserId = await resolveActorUserId(data);
  if (!actorUserId || actorUserId === data.userId) return data;

  return {
    ...data,
    metadata: {
      ...(data.metadata ?? {}),
      actorUserId,
    },
  };
};

export const getNotificationsByUserId = async userId => {
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.query.notifications.findMany({
    where: and(eq(notifications.userId, userId), gte(notifications.createdAt, cutoff)),
    orderBy: [desc(notifications.createdAt)],
  });

  return enrichNotifications(result);
};

/**
 * `ids` limits it to those notifications — a user's personal account and their
 * business account each have their own bell, and "mark all read" in one must
 * not clear the other. Without ids, every notification of the user is marked.
 */
export const markAsRead = async (userId, ids) => {
  const where = Array.isArray(ids)
    ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
    : eq(notifications.userId, userId);
  if (Array.isArray(ids) && ids.length === 0) return undefined;
  const [updatedNotification] = await db
    .update(notifications)
    .set({ isRead: true })
    .where(where)
    .returning();

  return updatedNotification;
};

/**
 * A business is a separate account with its own bell, but its notifications are
 * stored on the owner's / team member's user row. `metadata.audience` says which
 * bell a `business_*` notification belongs in:
 *  - 'business': about running the business (new booking, review, follower,
 *    a like on its post, a customer message, commission…)
 *  - 'personal': the recipient as a customer (their booking, a reply to their
 *    review or comment…)
 * Callers can set it themselves; otherwise the owner of the business gets the
 * business copy and everyone else the personal one.
 */
const tagAudience = async data => {
  const type = String(data.type ?? '');
  const metadata = data.metadata ?? {};
  if (metadata.audience) return data;

  // Activity on something published / hosted as a business (likes on its post,
  // a ticket sold for its event, someone joining its group…) goes to the
  // business's bell when the recipient runs that business — not the person's
  if (!type.startsWith('business_')) {
    const source = [
      ['postId', posts],
      ['storyId', stories],
      ['eventId', events],
      ['groupId', groups],
      ['livestreamId', livestreams],
    ].find(([key]) => typeof metadata[key] === 'string');
    if (!source) return data;
    const [key, table] = source;
    const row = await db
      .select({ businessId: table.businessId })
      .from(table)
      .where(eq(table.id, metadata[key]))
      .then(rows => rows[0])
      .catch(() => null); // never block a notification on this
    if (!row?.businessId) return data;
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, row.businessId),
      columns: { ownerId: true, logoUrl: true },
    });
    // To anyone else (followers, members, ticket holders): shown as from the
    // business — its logo, never the person behind it (see resolveActorUserId)
    const fromBusiness =
      table === events || table === groups || table === livestreams
        ? { organizerLogoUrl: business?.logoUrl ?? null }
        : {};
    // Posts / stories: the creator (may be a team member) or the owner
    const creator =
      table === posts || table === stories
        ? await db
            .select({ userId: table.userId })
            .from(table)
            .where(eq(table.id, metadata[key]))
            .then(rows => rows[0]?.userId)
        : null;
    if (business?.ownerId !== data.userId && creator !== data.userId) {
      return {
        ...data,
        metadata: { ...fromBusiness, ...metadata, businessId: row.businessId, audience: 'personal' },
      };
    }
    return { ...data, metadata: { ...metadata, businessId: row.businessId, audience: 'business' } };
  }

  let audience;
  if (type === 'business_message' || type === 'business_commission') audience = 'business';
  else if (String(data.redirectTo ?? '').startsWith('/bookings')) audience = 'personal';
  else if (metadata.businessId) {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, metadata.businessId),
      columns: { ownerId: true },
    });
    audience = business?.ownerId === data.userId ? 'business' : 'personal';
  }
  return audience ? { ...data, metadata: { ...metadata, audience } } : data;
};

export const createNotification = async data => {
  // Check user notification settings before creating
  const settings = await getNotificationSettingsByUserId(data.userId);

  const settingKey = typeToSetting[data.type];

  // If settings don't exist, defaults are true, so create
  // If setting exists and is true, create
  // If setting exists and is false, don't create
  // If type not mapped, create anyway (for future types)
  if (settings && settingKey && !settings[settingKey]) {
    return null; // Notification disabled by user
  }

  const notificationData = await addResolvedActorMetadata(await tagAudience(data));
  const [newNotification] = await db.insert(notifications).values(notificationData).returning();
  const [enrichedNotification] = await enrichNotifications([newNotification]);

  // Emit real-time notification via /notification namespace if io is available
  const ioInstance = getIO && getIO();
  if (ioInstance && notificationData.userId) {
    emitNotification(ioInstance, notificationData.userId, 'notification:new', enrichedNotification);
  }

  // Device push for every stored notification — reaches the app when it's backgrounded or
  // closed, where the socket above can't. Only fires once the in-app notification exists, so
  // the user's notification settings still apply. Chat copy is phrased for the notifications
  // list; the prefix is dropped so the push reads as the message itself.
  // Not awaited: the system banner for a backgrounded/closed app must not delay the caller.
  const pushNotification =
    enrichedNotification.type === 'chat_message'
      ? {
          ...enrichedNotification,
          message: String(enrichedNotification.message ?? '').replace(
            /^replied in your conversation : /,
            ''
          ),
        }
      : enrichedNotification;
  sendPushForNotification(pushNotification).catch(err =>
    logger.warn(`[push] notification ${enrichedNotification.id} not pushed: ${err?.message}`)
  );

  return enrichedNotification;
};

export const updateNotificationById = async (id, data) => {
  const [updatedNotification] = await db
    .update(notifications)
    .set(data)
    .where(eq(notifications.id, id))
    .returning();

  if (!updatedNotification) return null;

  return updatedNotification;
};

export const deleteNotificationById = async id => {
  const [deletedNotification] = await db
    .delete(notifications)
    .where(eq(notifications.id, id))
    .returning();

  if (!deletedNotification) return null;

  return deletedNotification;
};

export const deleteNotificationByTypeAndRelatedId = async (userId, type, relatedId) => {
  const [deleted] = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, type),
        eq(notifications.relatedId, relatedId)
      )
    )
    .returning();

  return deleted ?? null;
};

export const markStoryNotificationsRead = async (userId, storyId) => {
  const updated = await db
    .update(notifications)
    .set({ isRead: true, isSeen: true })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, 'social_update'),
        eq(notifications.isSeen, false),
        sql`${notifications.metadata}->>'storyId' = ${storyId}`
      )
    )
    .returning();

  return updated;
};

export const getNotificationSettingsByUserId = async userId => {
  const result = await db.query.userNotificationSettings.findFirst({
    where: eq(userNotificationSettings.userId, userId),
  });

  return result;
};

export const createOrUpdateNotificationSettings = async (userId, data) => {
  // First, try to find existing settings
  const existing = await getNotificationSettingsByUserId(userId);

  if (existing) {
    // Update existing
    const [updatedSettings] = await db
      .update(userNotificationSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userNotificationSettings.userId, userId))
      .returning();
    return updatedSettings;
  } else {
    // Create new
    const [newSettings] = await db
      .insert(userNotificationSettings)
      .values({ userId, ...data })
      .returning();
    return newSettings;
  }
};
