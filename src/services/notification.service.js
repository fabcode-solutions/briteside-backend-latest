import { db } from '../config/database.js';
import {
  events,
  groups,
  groupMembers,
  notifications,
  organizers,
  talentProfiles,
  talentSessions,
  userNotificationSettings,
} from '../db/schema/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { getIO } from '../utils/io.js';
import { emitNotification } from '../socket/emitter.js';
import { getActorProfiles } from '../utils/helper.js';

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
  const result = await db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: [desc(notifications.createdAt)],
  });

  return enrichNotifications(result);
};

export const markAsRead = async userId => {
  const [updatedNotification] = await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.userId, userId))
    .returning();

  return updatedNotification;
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

  const notificationData = await addResolvedActorMetadata(data);
  const [newNotification] = await db.insert(notifications).values(notificationData).returning();
  const [enrichedNotification] = await enrichNotifications([newNotification]);

  // Emit real-time notification via /notification namespace if io is available
  const ioInstance = getIO && getIO();
  if (ioInstance && notificationData.userId) {
    emitNotification(ioInstance, notificationData.userId, 'notification:new', enrichedNotification);
  }

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
