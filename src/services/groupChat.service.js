import { db } from '../db/index.js';
import {
  groupChatRooms,
  groupChatMessages,
  groupMessageReadReceipts,
  groupMessageReactions,
  groupMembers,
  groups,
  users,
  chatModerationActions,
} from '../db/schema/index.js';
import { eq, and, desc, asc, count, gte, lte, sql, inArray } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';

// Roles that count as "can moderate this group's chat".
// NOTE: confirm this matches your group_member_role enum values exactly.
const ORGANIZER_ROLES = ['admin', 'organizer'];

export class GroupChatService {
  static async createGroupChatRoom(groupId) {
    try {
      const existingRoom = await db.query.groupChatRooms.findFirst({
        where: eq(groupChatRooms.groupId, groupId),
      });
      if (existingRoom) return existingRoom;

      const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
      if (!group) throw new ApiError(404, 'Group not found');

      const [chatRoom] = await db
        .insert(groupChatRooms)
        .values({
          groupId,
          name: `${group.name} - Group Chat`,
          description: `Chat for members of ${group.name}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return chatRoom;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create group chat room error:', error);
      throw new ApiError(500, 'Failed to create group chat room');
    }
  }

  static async checkChatAccess(userId, groupId) {
    try {
      const membership = await db.query.groupMembers.findFirst({
        where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
      });

      if (!membership) {
        return { hasAccess: false, reason: 'no_access' };
      }
      if (membership.status === 'blocked') {
        return { hasAccess: false, reason: 'blocked' };
      }
      if (membership.status !== 'joined') {
        return { hasAccess: false, reason: 'no_access' };
      }

      return {
        hasAccess: true,
        reason: ORGANIZER_ROLES.includes(membership.role) ? 'admin' : 'member',
      };
    } catch (error) {
      console.error('Check group chat access error:', error);
      throw new ApiError(500, 'Failed to check chat access');
    }
  }

  static async getGroupChatRoom(groupId, userId) {
    try {
      const access = await this.checkChatAccess(userId, groupId);
      if (!access.hasAccess) {
        if (access.reason === 'blocked') {
          throw new ApiError(403, 'You have been blocked from this group chat');
        }
        throw new ApiError(403, "You don't have access to this group chat");
      }

      let chatRoom = await db.query.groupChatRooms.findFirst({
        where: eq(groupChatRooms.groupId, groupId),
        with: { group: true },
      });
      if (!chatRoom) chatRoom = await this.createGroupChatRoom(groupId);

      const [participantCount] = await db
        .select({ count: count() })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'joined')));

      await db
        .insert(groupMessageReadReceipts)
        .values({ groupChatRoomId: chatRoom.id, userId, lastReadAt: new Date(), unreadCount: 0 })
        .onConflictDoNothing();

      const userReadReceipt = await db.query.groupMessageReadReceipts.findFirst({
        where: and(
          eq(groupMessageReadReceipts.groupChatRoomId, chatRoom.id),
          eq(groupMessageReadReceipts.userId, userId)
        ),
      });

      return {
        ...chatRoom,
        participantCount: participantCount.count,
        unreadCount: userReadReceipt?.unreadCount || 0,
        userRole: access.reason,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get group chat room error:', error);
      throw new ApiError(500, 'Failed to get group chat room');
    }
  }

  static async sendMessage(userId, chatRoomId, messageData) {
    try {
      const { content, messageType = 'text', replyToId, metadata = {} } = messageData;

      const chatRoom = await db.query.groupChatRooms.findFirst({
        where: eq(groupChatRooms.id, chatRoomId),
      });
      if (!chatRoom) throw new ApiError(404, 'Chat room not found');

      const access = await this.checkChatAccess(userId, chatRoom.groupId);
      if (!access.hasAccess) {
        if (access.reason === 'blocked') {
          throw new ApiError(403, 'You have been blocked from this group chat');
        }
        throw new ApiError(403, 'You are not a member of this group');
      }

      // Only user-authored free text goes through moderation. `content` for
      // location/image/video/file messages is system-generated (a geocoded
      // address, a storage URL, etc.) — running that through the AI text
      // classifier produces false MODERATION_BLOCKED (422) verdicts, e.g. an
      // address string getting flagged as "remove".
      const NON_MODERATED_TYPES = ['location', 'image', 'video', 'file'];
      const shouldModerate = !NON_MODERATED_TYPES.includes(messageType);

      const moderated = shouldModerate
        ? await TextModerationService.assertAllowed({
            entityType: TEXT_ENTITY.MESSAGE,
            entityCreatorId: userId,
            texts: [content],
            mask: true,
          })
        : { action: 'keep', texts: [content] };

      const [message] = await db
        .insert(groupChatMessages)
        .values({
          groupChatRoomId: chatRoomId,
          senderId: userId,
          content: moderated.texts[0],
          messageType,
          replyToId,
          metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (shouldModerate) {
        await TextModerationService.recordIfFlagged(moderated, {
          entityType: TEXT_ENTITY.MESSAGE,
          entityId: message.id,
          userId,
          fieldNames: ['content'],
          texts: [moderated.texts[0]],
        });
      }

      const joinedMembers = await db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, chatRoom.groupId),
            eq(groupMembers.status, 'joined'),
            sql`${groupMembers.userId} != ${userId}`
          )
        );

      if (joinedMembers.length > 0) {
        await db
          .insert(groupMessageReadReceipts)
          .values(
            joinedMembers.map(m => ({
              groupChatRoomId: chatRoomId,
              userId: m.userId,
              lastReadAt: new Date(0),
              unreadCount: 0,
            }))
          )
          .onConflictDoNothing();

        await db
          .update(groupMessageReadReceipts)
          .set({ unreadCount: sql`${groupMessageReadReceipts.unreadCount} + 1` })
          .where(
            and(
              eq(groupMessageReadReceipts.groupChatRoomId, chatRoomId),
              inArray(
                groupMessageReadReceipts.userId,
                joinedMembers.map(m => m.userId)
              )
            )
          );
      }

      return await db.query.groupChatMessages.findFirst({
        where: eq(groupChatMessages.id, message.id),
        with: {
          sender: {
            columns: { id: true, firstName: true, lastName: true, profilePictureUrl: true },
          },
          replyTo: { with: { sender: { columns: { id: true, firstName: true, lastName: true } } } },
        },
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Send group message error:', error);
      throw new ApiError(500, 'Failed to send message');
    }
  }

  static async updateMessage(userId, messageId, updateData) {
    try {
      const { content, messageType, metadata } = updateData;

      const message = await db.query.groupChatMessages.findFirst({
        where: eq(groupChatMessages.id, messageId),
      });
      if (!message) throw new ApiError(404, 'Message not found');
      if (message.senderId !== userId)
        throw new ApiError(403, 'You can only edit your own messages');
      if (message.isDeleted) throw new ApiError(400, 'Cannot edit deleted message');

      const updates = { isEdited: true, updatedAt: new Date() };

      let contentModeration = { action: 'keep' };
      if (content !== undefined) {
        contentModeration = await TextModerationService.assertAllowed({
          entityType: TEXT_ENTITY.MESSAGE,
          entityId: messageId,
          entityCreatorId: userId,
          texts: [content],
          mask: true,
        });
        updates.content = contentModeration.texts[0];
      }
      if (messageType !== undefined) updates.messageType = messageType;
      if (metadata !== undefined) updates.metadata = metadata;

      await db.update(groupChatMessages).set(updates).where(eq(groupChatMessages.id, messageId));

      await TextModerationService.recordIfFlagged(contentModeration, {
        entityType: TEXT_ENTITY.MESSAGE,
        entityId: messageId,
        userId,
        fieldNames: ['content'],
        texts: [updates.content],
      });

      return await db.query.groupChatMessages.findFirst({
        where: eq(groupChatMessages.id, messageId),
        with: {
          sender: {
            columns: { id: true, firstName: true, lastName: true, profilePictureUrl: true },
          },
        },
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Update group message error:', error);
      throw new ApiError(500, 'Failed to update message');
    }
  }

  static async getMessages(userId, chatRoomId, options = {}) {
    try {
      const { page = 1, limit = 50, before, after } = options;

      const chatRoom = await db.query.groupChatRooms.findFirst({
        where: eq(groupChatRooms.id, chatRoomId),
      });
      if (!chatRoom) throw new ApiError(404, 'Chat room not found');

      const access = await this.checkChatAccess(userId, chatRoom.groupId);
      if (!access.hasAccess) {
        if (access.reason === 'blocked') {
          throw new ApiError(403, 'You have been blocked from this group chat');
        }
        throw new ApiError(403, "You don't have access to this group chat");
      }

      const offset = (page - 1) * limit;
      let conditions = [
        eq(groupChatMessages.groupChatRoomId, chatRoomId),
        eq(groupChatMessages.isDeleted, false),
      ];

      if (before) {
        const beforeMessage = await db.query.groupChatMessages.findFirst({
          where: eq(groupChatMessages.id, before),
        });
        if (beforeMessage)
          conditions.push(lte(groupChatMessages.createdAt, beforeMessage.createdAt));
      }
      if (after) {
        const afterMessage = await db.query.groupChatMessages.findFirst({
          where: eq(groupChatMessages.id, after),
        });
        if (afterMessage) conditions.push(gte(groupChatMessages.createdAt, afterMessage.createdAt));
      }

      const messages = await db.query.groupChatMessages.findMany({
        where: and(...conditions),
        with: {
          sender: {
            columns: { id: true, firstName: true, lastName: true, profilePictureUrl: true },
          },
          replyTo: { with: { sender: { columns: { id: true, firstName: true, lastName: true } } } },
          reactions: { with: { user: { columns: { id: true, firstName: true, lastName: true } } } },
        },
        orderBy: desc(groupChatMessages.createdAt),
        limit,
        offset: before || after ? 0 : offset,
      });

      const filterEnabled = await TextModerationService.getFilterEnabled(userId);
      await TextModerationService.maskFlaggedText(messages, {
        entityType: TEXT_ENTITY.MESSAGE,
        fields: ['content'],
        filterEnabled,
      });

      return { messages: messages.reverse(), hasMore: messages.length === limit, page, limit };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get group messages error:', error);
      throw new ApiError(500, 'Failed to get messages');
    }
  }

  static async markAsRead(userId, chatRoomId, messageId = null) {
    try {
      const updateData = { lastReadAt: new Date(), unreadCount: 0 };
      if (messageId) updateData.lastReadMessageId = messageId;

      await db
        .update(groupMessageReadReceipts)
        .set(updateData)
        .where(
          and(
            eq(groupMessageReadReceipts.groupChatRoomId, chatRoomId),
            eq(groupMessageReadReceipts.userId, userId)
          )
        );

      return { success: true };
    } catch (error) {
      console.error('Mark group chat as read error:', error);
      throw new ApiError(500, 'Failed to mark messages as read');
    }
  }

  static async addReaction(userId, messageId, emoji) {
    try {
      const message = await db.query.groupChatMessages.findFirst({
        where: eq(groupChatMessages.id, messageId),
      });
      if (!message) throw new ApiError(404, 'Message not found');

      const chatRoom = await db.query.groupChatRooms.findFirst({
        where: eq(groupChatRooms.id, message.groupChatRoomId),
      });
      const access = await this.checkChatAccess(userId, chatRoom.groupId);
      if (!access.hasAccess) throw new ApiError(403, "You don't have access to this chat");

      const [reaction] = await db
        .insert(groupMessageReactions)
        .values({ messageId, userId, emoji, createdAt: new Date() })
        .onConflictDoUpdate({
          target: [
            groupMessageReactions.messageId,
            groupMessageReactions.userId,
            groupMessageReactions.emoji,
          ],
          set: { createdAt: new Date() },
        })
        .returning();

      return { ...reaction, chatRoomId: message.groupChatRoomId };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Add group reaction error:', error);
      throw new ApiError(500, 'Failed to add reaction');
    }
  }

  static async removeReaction(userId, messageId, emoji) {
    try {
      const message = await db.query.groupChatMessages.findFirst({
        where: eq(groupChatMessages.id, messageId),
      });

      await db
        .delete(groupMessageReactions)
        .where(
          and(
            eq(groupMessageReactions.messageId, messageId),
            eq(groupMessageReactions.userId, userId),
            eq(groupMessageReactions.emoji, emoji)
          )
        );

      return { success: true, chatRoomId: message?.groupChatRoomId };
    } catch (error) {
      console.error('Remove group reaction error:', error);
      throw new ApiError(500, 'Failed to remove reaction');
    }
  }

  static async getParticipants(userId, chatRoomId, options = {}) {
    try {
      const { page = 1, limit = 50, role } = options;
      const offset = (page - 1) * limit;

      const chatRoom = await db.query.groupChatRooms.findFirst({
        where: eq(groupChatRooms.id, chatRoomId),
      });
      if (!chatRoom) throw new ApiError(404, 'Chat room not found');

      const access = await this.checkChatAccess(userId, chatRoom.groupId);
      if (!access.hasAccess) throw new ApiError(403, "You don't have access to this chat");

      // 'blocked' included so organizers can see + unblock them.
      // Requires 'blocked' to exist on the group_member_status enum — see migration note.
      let conditions = [
        eq(groupMembers.groupId, chatRoom.groupId),
        inArray(groupMembers.status, ['joined', 'blocked']),
      ];
      if (role) conditions.push(eq(groupMembers.role, role));

      const participants = await db
        .select({
          id: groupMembers.id,
          role: groupMembers.role,
          status: groupMembers.status,
          joinedAt: groupMembers.joinedAt,
          userId: groupMembers.userId,
          firstName: users.firstName,
          lastName: users.lastName,
          profilePictureUrl: users.image,
        })
        .from(groupMembers)
        .leftJoin(users, eq(groupMembers.userId, users.id))
        .where(and(...conditions))
        .orderBy(asc(groupMembers.role), desc(groupMembers.joinedAt))
        .limit(limit)
        .offset(offset);

      const [totalCount] = await db
        .select({ count: count() })
        .from(groupMembers)
        .where(and(...conditions));

      return {
        participants,
        pagination: {
          page,
          limit,
          total: totalCount.count,
          pages: Math.ceil(totalCount.count / limit),
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get group chat participants error:', error);
      throw new ApiError(500, 'Failed to get participants');
    }
  }

  static async checkChatAccessList(userId) {
    try {
      const memberships = await db
        .select({ group: groups })
        .from(groupMembers)
        .innerJoin(groups, eq(groupMembers.groupId, groups.id))
        .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, 'joined')));

      return memberships.map(row => row.group);
    } catch (error) {
      console.error('Check group chat access list error:', error);
      throw new ApiError(500, 'Failed to get accessible groups');
    }
  }

  static async listGroupChatsForUser(userId) {
    const memberships = await db
      .select({ group: groups })
      .from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, 'joined')));

    if (memberships.length === 0) return [];

    const groupIds = memberships.map(m => m.group.id);

    const chatRooms = await db.query.groupChatRooms.findMany({
      where: inArray(groupChatRooms.groupId, groupIds),
    });
    if (chatRooms.length === 0) return [];

    const roomIds = chatRooms.map(r => r.id);
    const roomByGroupId = new Map(chatRooms.map(r => [r.groupId, r]));

    const latestMessages = await db
      .select({
        id: groupChatMessages.id,
        groupChatRoomId: groupChatMessages.groupChatRoomId,
        senderId: groupChatMessages.senderId,
        messageType: groupChatMessages.messageType,
        content: groupChatMessages.content,
        createdAt: groupChatMessages.createdAt,
      })
      .from(groupChatMessages)
      .where(
        and(
          inArray(groupChatMessages.groupChatRoomId, roomIds),
          eq(groupChatMessages.isDeleted, false)
        )
      )
      .orderBy(desc(groupChatMessages.createdAt));

    const latestByRoom = new Map();
    for (const m of latestMessages) {
      if (!latestByRoom.has(m.groupChatRoomId)) latestByRoom.set(m.groupChatRoomId, m);
    }

    const receipts = await db
      .select({
        groupChatRoomId: groupMessageReadReceipts.groupChatRoomId,
        unreadCount: groupMessageReadReceipts.unreadCount,
      })
      .from(groupMessageReadReceipts)
      .where(
        and(
          inArray(groupMessageReadReceipts.groupChatRoomId, roomIds),
          eq(groupMessageReadReceipts.userId, userId)
        )
      );
    const unreadByRoom = new Map(receipts.map(r => [r.groupChatRoomId, r.unreadCount]));

    return memberships
      .map(({ group }) => {
        const room = roomByGroupId.get(group.id);
        if (!room) return null; // chat never started for this group — nothing to preview

        const lastMessage = latestByRoom.get(room.id) || null;
        return {
          id: room.id, // this is the groupChatRoomId — same id used to fetch messages
          conversationKind: 'group',
          groupId: group.id,
          group: {
            id: group.id,
            name: group.name,
            slug: group.slug,
            coverImageUrl: group.coverImageUrl,
          },
          lastMessageSent: lastMessage
            ? {
                id: lastMessage.id,
                senderId: lastMessage.senderId,
                messageType: lastMessage.messageType,
                content: lastMessage.content,
                createdAt: lastMessage.createdAt,
              }
            : null,
          unreadCount: unreadByRoom.get(room.id) ?? 0,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
        };
      })
      .filter(Boolean);
  }

  static async deleteMessage(userId, messageId) {
    try {
      const message = await db.query.groupChatMessages.findFirst({
        where: eq(groupChatMessages.id, messageId),
      });
      if (!message) throw new ApiError(404, 'Message not found');
      if (message.isDeleted) throw new ApiError(400, 'Message already deleted');

      const chatRoom = await db.query.groupChatRooms.findFirst({
        where: eq(groupChatRooms.id, message.groupChatRoomId),
      });
      if (!chatRoom) throw new ApiError(404, 'Chat room not found');

      const membership = await db.query.groupMembers.findFirst({
        where: and(eq(groupMembers.groupId, chatRoom.groupId), eq(groupMembers.userId, userId)),
      });
      if (!membership || membership.status !== 'joined') {
        throw new ApiError(403, "You don't have access to this chat");
      }

      const isOwner = message.senderId === userId;
      const isOrganizer = ORGANIZER_ROLES.includes(membership.role);
      if (!isOwner && !isOrganizer) {
        throw new ApiError(403, 'You do not have permission to delete this message');
      }

      await db
        .update(groupChatMessages)
        .set({ isDeleted: true, deletedAt: new Date(), deletedBy: userId, updatedAt: new Date() })
        .where(eq(groupChatMessages.id, messageId));

      // Only log a moderation action when an organizer removes someone else's message
      if (isOrganizer && !isOwner) {
        await db.insert(chatModerationActions).values({
          chatRoomId: chatRoom.id,
          chatRoomType: 'group',
          moderatorId: userId,
          targetUserId: message.senderId,
          targetMessageId: messageId,
          actionType: 'delete_message',
          createdAt: new Date(),
        });
      }

      return { success: true, messageId, chatRoomId: chatRoom.id, groupId: chatRoom.groupId };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete group message error:', error);
      throw new ApiError(500, 'Failed to delete message');
    }
  }

  static async blockMember(requesterId, groupId, targetUserId, options = {}) {
    try {
      const { reason, duration } = options;

      if (targetUserId === requesterId) throw new ApiError(400, 'You cannot block yourself');

      const requesterMembership = await db.query.groupMembers.findFirst({
        where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, requesterId)),
      });
      if (!requesterMembership || requesterMembership.status !== 'joined') {
        throw new ApiError(403, "You don't have access to this group");
      }
      if (!ORGANIZER_ROLES.includes(requesterMembership.role)) {
        throw new ApiError(403, 'Only organizers can block members');
      }

      const targetMembership = await db.query.groupMembers.findFirst({
        where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)),
      });
      if (!targetMembership) throw new ApiError(404, 'Member not found in this group');
      if (ORGANIZER_ROLES.includes(targetMembership.role)) {
        throw new ApiError(403, 'Cannot block another organizer');
      }

      await db
        .update(groupMembers)
        .set({ status: 'blocked' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

      const chatRoom = await db.query.groupChatRooms.findFirst({
        where: eq(groupChatRooms.groupId, groupId),
      });

      if (chatRoom) {
        await db.insert(chatModerationActions).values({
          chatRoomId: chatRoom.id,
          chatRoomType: 'group',
          moderatorId: requesterId,
          targetUserId,
          actionType: 'block_member',
          reason,
          duration,
          createdAt: new Date(),
        });
      }

      return { success: true, groupId, targetUserId, chatRoomId: chatRoom?.id };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Block group member error:', error);
      throw new ApiError(500, 'Failed to block member');
    }
  }

  static async unblockMember(requesterId, groupId, targetUserId) {
    try {
      const requesterMembership = await db.query.groupMembers.findFirst({
        where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, requesterId)),
      });
      if (!requesterMembership || !ORGANIZER_ROLES.includes(requesterMembership.role)) {
        throw new ApiError(403, 'Only organizers can unblock members');
      }

      await db
        .update(groupMembers)
        .set({ status: 'joined' })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

      return { success: true, groupId, targetUserId };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Unblock group member error:', error);
      throw new ApiError(500, 'Failed to unblock member');
    }
  }
}
