import { db } from '../db/index.js';
import {
  eventChatRooms,
  eventChatParticipants,
  eventChatMessages,
  eventMessageReadReceipts,
  eventMessageReactions,
  purchasedTickets,
  events,
  organizers,
  users,
} from '../db/schema/index.js';
import { eq, and, desc, asc, count, gte, lte, sql, inArray , lt } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from './moderation/textModeration.service.js';

export class EventChatService {
  /**
   * Create or get event chat room - automatically called when event is published
   */
  static async createEventChatRoom(eventId) {
    try {
      // Check if chat room already exists
      const existingRoom = await db.query.eventChatRooms.findFirst({
        where: eq(eventChatRooms.eventId, eventId),
      });

      if (existingRoom) {
        return existingRoom;
      }

      // Get event details
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        with: { organizer: true },
      });

      if (!event) {
        throw new ApiError(404, 'Event not found');
      }

      // Create chat room
      const [chatRoom] = await db
        .insert(eventChatRooms)
        .values({
          eventId,
          name: `${event.title} - Event Chat`,
          description: `Chat for attendees of ${event.title}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Add organizer as moderator
      await this.addParticipant(chatRoom.id, event.organizer.userId, 'organizer');

      return chatRoom;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Create event chat room error:', error);
      throw new ApiError(500, 'Failed to create event chat room');
    }
  }

  /**
   * Add participant to event chat - called when user purchases tickets
   */
  static async addParticipant(chatRoomId, userId, role = 'participant') {
    try {
      // Check if participant already exists
      const existingParticipant = await db.query.eventChatParticipants.findFirst({
        where: and(
          eq(eventChatParticipants.eventChatRoomId, chatRoomId),
          eq(eventChatParticipants.userId, userId)
        ),
      });

      if (existingParticipant) {
        return existingParticipant;
      }

      const [participant] = await db
        .insert(eventChatParticipants)
        .values({
          eventChatRoomId: chatRoomId,
          userId,
          role,
          joinedAt: new Date(),
          lastActiveAt: new Date(),
        })
        .returning();

      // Initialize read receipt
      await db
        .insert(eventMessageReadReceipts)
        .values({
          eventChatRoomId: chatRoomId,
          userId,
          lastReadAt: new Date(),
          unreadCount: 0,
        })
        .onConflictDoNothing();

      return participant;
    } catch (error) {
      console.error('Add participant error:', error);
      throw new ApiError(500, 'Failed to add participant to chat');
    }
  }

  /**
   * Check if user has access to event chat
   */
  static async checkChatAccess(userId, eventId) {
    try {
      // Fetch event (needed for isChatEnabled and organizer check)
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        with: { organizer: true },
      });

      if (!event) {
        return { hasAccess: false, reason: 'no_access' };
      }

      // Organizer always has access regardless of chat enabled state
      if (event.organizer.userId === userId) {
        return { hasAccess: true, reason: 'organizer' };
      }

      // All other users must have an active ticket
      const hasTickets = await db.query.purchasedTickets.findFirst({
        where: and(
          eq(purchasedTickets.userId, userId),
          eq(purchasedTickets.eventId, eventId),
          eq(purchasedTickets.status, 'active')
        ),
      });

      if (!hasTickets) {
        return { hasAccess: false, reason: 'no_access' };
      }

      // Ticket holder: check whether chat is enabled
      if (!event.isChatEnabled) {
        return { hasAccess: false, reason: 'chat_disabled' };
      }

      return { hasAccess: true, reason: 'ticket_holder' };
    } catch (error) {
      console.error('Check chat access error:', error);
      throw new ApiError(500, 'Failed to check chat access');
    }
  }

  /**
   * Get event chat room with participant info
   */
  static async getEventChatRoom(eventId, userId) {
    try {
      // Check access first
      const access = await this.checkChatAccess(userId, eventId);
      if (!access.hasAccess) {
        throw new ApiError(403, "You don't have access to this event chat");
      }

      // Get or create chat room
      let chatRoom = await db.query.eventChatRooms.findFirst({
        where: eq(eventChatRooms.eventId, eventId),
        with: {
          event: {
            with: { organizer: true },
          },
        },
      });

      if (!chatRoom) {
        chatRoom = await this.createEventChatRoom(eventId);
      }

      // Ensure user is added as participant
      const role = access.reason === 'organizer' ? 'organizer' : 'participant';
      await this.addParticipant(chatRoom.id, userId, role);

      // Get participant count
      const [participantCount] = await db
        .select({ count: count() })
        .from(eventChatParticipants)
        .where(eq(eventChatParticipants.eventChatRoomId, chatRoom.id));

      // Get user's unread count
      const userReadReceipt = await db.query.eventMessageReadReceipts.findFirst({
        where: and(
          eq(eventMessageReadReceipts.eventChatRoomId, chatRoom.id),
          eq(eventMessageReadReceipts.userId, userId)
        ),
      });

      return {
        ...chatRoom,
        participantCount: participantCount.count,
        unreadCount: userReadReceipt?.unreadCount || 0,
        userRole: role,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Get event chat room error:', error);
      throw new ApiError(500, 'Failed to get event chat room');
    }
  }

  /**
   * Send message to event chat
   */
  static async sendMessage(userId, chatRoomId, messageData) {
    try {
      const { content, messageType = 'text', replyToId, metadata = {} } = messageData;

      // Verify user is participant
      const participant = await db.query.eventChatParticipants.findFirst({
        where: and(
          eq(eventChatParticipants.eventChatRoomId, chatRoomId),
          eq(eventChatParticipants.userId, userId)
        ),
      });

      if (!participant) {
        throw new ApiError(403, 'You are not a participant in this chat');
      }

      // Check if user is muted
      if (participant.isMuted) {
        const now = new Date();
        if (!participant.mutedUntil || participant.mutedUntil > now) {
          throw new ApiError(403, 'You are muted in this chat');
        } else {
          // Unmute user if mute period has expired
          await db
            .update(eventChatParticipants)
            .set({
              isMuted: false,
              mutedUntil: null,
              mutedBy: null,
            })
            .where(
              and(
                eq(eventChatParticipants.eventChatRoomId, chatRoomId),
                eq(eventChatParticipants.userId, userId)
              )
            );
        }
      }

      const moderated = await TextModerationService.assertAllowed({
        entityType: TEXT_ENTITY.MESSAGE,
        entityCreatorId: userId,
        texts: [content],
        mask: true,
      });

      // Create message
      const [message] = await db
        .insert(eventChatMessages)
        .values({
          eventChatRoomId: chatRoomId,
          senderId: userId,
          content: moderated.texts[0],
          messageType,
          replyToId,
          metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await TextModerationService.recordIfFlagged(moderated, {
        entityType: TEXT_ENTITY.MESSAGE,
        entityId: message.id,
        userId,
        fieldNames: ['content'],
        texts: [moderated.texts[0]],
      });

      // Update participant's last active time
      await db
        .update(eventChatParticipants)
        .set({ lastActiveAt: new Date() })
        .where(
          and(
            eq(eventChatParticipants.eventChatRoomId, chatRoomId),
            eq(eventChatParticipants.userId, userId)
          )
        );

      // Update unread counts for other participants
      await db
        .update(eventMessageReadReceipts)
        .set({
          unreadCount: sql`${eventMessageReadReceipts.unreadCount} + 1`,
        })
        .where(
          and(
            eq(eventMessageReadReceipts.eventChatRoomId, chatRoomId),
            sql`${eventMessageReadReceipts.userId} != ${userId}`
          )
        );

      // Get message with sender info
      const messageWithSender = await db.query.eventChatMessages.findFirst({
        where: eq(eventChatMessages.id, message.id),
        with: {
          sender: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              profilePictureUrl: true,
            },
          },
          replyTo: {
            with: {
              sender: {
                columns: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });

      return messageWithSender;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Send message error:', error);
      throw new ApiError(500, 'Failed to send message');
    }
  }

  /**
   * Update message content, type, and metadata
   */
  static async updateMessage(userId, messageId, updateData) {
    try {
      const { content, messageType, metadata } = updateData;

      // Get the message to verify ownership
      const message = await db.query.eventChatMessages.findFirst({
        where: eq(eventChatMessages.id, messageId),
      });

      if (!message) {
        throw new ApiError(404, 'Message not found');
      }

      if (message.senderId !== userId) {
        throw new ApiError(403, 'You can only edit your own messages');
      }

      if (message.isDeleted) {
        throw new ApiError(400, 'Cannot edit deleted message');
      }

      // Build update object with only provided fields
      const updates = {
        isEdited: true,
        updatedAt: new Date(),
      };

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

      // Update the message
      const [updatedMessage] = await db
        .update(eventChatMessages)
        .set(updates)
        .where(eq(eventChatMessages.id, messageId))
        .returning();

      await TextModerationService.recordIfFlagged(contentModeration, {
        entityType: TEXT_ENTITY.MESSAGE,
        entityId: messageId,
        userId,
        fieldNames: ['content'],
        texts: [updates.content],
      });

      // Get message with sender info
      const messageWithSender = await db.query.eventChatMessages.findFirst({
        where: eq(eventChatMessages.id, messageId),
        with: {
          sender: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              profilePictureUrl: true,
            },
          },
        },
      });

      return messageWithSender;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Update message error:', error);
      throw new ApiError(500, 'Failed to update message');
    }
  }

  /**
   * Get chat messages with pagination
   */
  static async getMessages(userId, chatRoomId, options = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        before, // Message ID to get messages before
        after, // Message ID to get messages after
      } = options;

      // Verify user has access
      const participant = await db.query.eventChatParticipants.findFirst({
        where: and(
          eq(eventChatParticipants.eventChatRoomId, chatRoomId),
          eq(eventChatParticipants.userId, userId)
        ),
      });

      if (!participant) {
        throw new ApiError(403, "You don't have access to this chat");
      }

      const offset = (page - 1) * limit;
      let conditions = [
        eq(eventChatMessages.eventChatRoomId, chatRoomId),
        eq(eventChatMessages.isDeleted, false),
      ];

      // Add cursor-based pagination conditions
      if (before) {
        const beforeMessage = await db.query.eventChatMessages.findFirst({
          where: eq(eventChatMessages.id, before),
        });
        if (beforeMessage) {
          conditions.push(lte(eventChatMessages.createdAt, beforeMessage.createdAt));
        }
      }

      if (after) {
        const afterMessage = await db.query.eventChatMessages.findFirst({
          where: eq(eventChatMessages.id, after),
        });
        if (afterMessage) {
          conditions.push(gte(eventChatMessages.createdAt, afterMessage.createdAt));
        }
      }

      const messages = await db.query.eventChatMessages.findMany({
        where: and(...conditions),
        with: {
          sender: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              profilePictureUrl: true,
            },
          },
          replyTo: {
            with: {
              sender: {
                columns: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          reactions: {
            with: {
              user: {
                columns: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
        orderBy: desc(eventChatMessages.createdAt),
        limit,
        offset: before || after ? 0 : offset,
      });

      const eventChatFilterEnabled = await TextModerationService.getFilterEnabled(userId);
      await TextModerationService.maskFlaggedText(messages, {
        entityType: TEXT_ENTITY.MESSAGE,
        fields: ['content'],
        filterEnabled: eventChatFilterEnabled,
      });

      return {
        messages: messages.reverse(), // Reverse to show oldest first
        hasMore: messages.length === limit,
        page,
        limit,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Get messages error:', error);
      throw new ApiError(500, 'Failed to get messages');
    }
  }

  /**
   * Mark messages as read
   */
  static async markAsRead(userId, chatRoomId, messageId = null) {
    try {
      const updateData = {
        lastReadAt: new Date(),
        unreadCount: 0,
      };

      if (messageId) {
        updateData.lastReadMessageId = messageId;
      }

      await db
        .update(eventMessageReadReceipts)
        .set(updateData)
        .where(
          and(
            eq(eventMessageReadReceipts.eventChatRoomId, chatRoomId),
            eq(eventMessageReadReceipts.userId, userId)
          )
        );

      return { success: true };
    } catch (error) {
      console.error('Mark as read error:', error);
      throw new ApiError(500, 'Failed to mark messages as read');
    }
  }

  /**
   * Add reaction to message
   */
  static async addReaction(userId, messageId, emoji) {
    try {
      // Verify message exists and user has access
      const message = await db.query.eventChatMessages.findFirst({
        where: eq(eventChatMessages.id, messageId),
        with: { chatRoom: true },
      });

      if (!message) {
        throw new ApiError(404, 'Message not found');
      }

      const participant = await db.query.eventChatParticipants.findFirst({
        where: and(
          eq(eventChatParticipants.eventChatRoomId, message.eventChatRoomId),
          eq(eventChatParticipants.userId, userId)
        ),
      });

      if (!participant) {
        throw new ApiError(403, "You don't have access to this chat");
      }

      // Add or update reaction
      const [reaction] = await db
        .insert(eventMessageReactions)
        .values({
          messageId,
          userId,
          emoji,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            eventMessageReactions.messageId,
            eventMessageReactions.userId,
            eventMessageReactions.emoji,
          ],
          set: { createdAt: new Date() },
        })
        .returning();

      // Include chatRoomId with the returned reaction so callers (controllers)
      // can emit socket events to the correct room without having to re-query.
      return {
        ...reaction,
        chatRoomId: message.eventChatRoomId,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Add reaction error:', error);
      throw new ApiError(500, 'Failed to add reaction');
    }
  }

  /**
   * Remove reaction from message
   */
  static async removeReaction(userId, messageId, emoji) {
    try {
      // Get message to obtain the chatRoomId for socket emission
      const message = await db.query.eventChatMessages.findFirst({
        where: eq(eventChatMessages.id, messageId),
      });

      await db
        .delete(eventMessageReactions)
        .where(
          and(
            eq(eventMessageReactions.messageId, messageId),
            eq(eventMessageReactions.userId, userId),
            eq(eventMessageReactions.emoji, emoji)
          )
        );

      return { success: true, chatRoomId: message?.eventChatRoomId };
    } catch (error) {
      console.error('Remove reaction error:', error);
      throw new ApiError(500, 'Failed to remove reaction');
    }
  }

  /**
   * Get chat participants
   */
  static async getParticipants(userId, chatRoomId, options = {}) {
    try {
      const { page = 1, limit = 50, role } = options;
      const offset = (page - 1) * limit;

      // Verify user has access
      const participant = await db.query.eventChatParticipants.findFirst({
        where: and(
          eq(eventChatParticipants.eventChatRoomId, chatRoomId),
          eq(eventChatParticipants.userId, userId)
        ),
      });

      if (!participant) {
        throw new ApiError(403, "You don't have access to this chat");
      }

      let conditions = [eq(eventChatParticipants.eventChatRoomId, chatRoomId)];
      if (role) {
        conditions.push(eq(eventChatParticipants.role, role));
      }

      const participants = await db.query.eventChatParticipants.findMany({
        where: and(...conditions),
        with: {
          user: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              profilePictureUrl: true,
            },
          },
        },
        orderBy: [
          asc(eventChatParticipants.role), // organizers first
          desc(eventChatParticipants.lastActiveAt),
        ],
        limit,
        offset,
      });

      const [totalCount] = await db
        .select({ count: count() })
        .from(eventChatParticipants)
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
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Get participants error:', error);
      throw new ApiError(500, 'Failed to get participants');
    }
  }

  /**
   * Get list of events where user has access to chat
   */
  static async checkChatAccessList(userId) {
    try {
      const now = new Date();

      // 1. Events user organizes
      const organizerEvents = (
        await db
          .select({ event: events })
          .from(events)
          .innerJoin(organizers, eq(events.organizerId, organizers.id))
          .where(eq(organizers.userId, userId))
      ).map(row => row.event);

      // 2. Events where user has active tickets
      const activeTicketEventIds = (
        await db
          .selectDistinct({ eventId: purchasedTickets.eventId })
          .from(purchasedTickets)
          .where(and(eq(purchasedTickets.userId, userId), eq(purchasedTickets.status, 'active')))
      ).map(t => t.eventId);

      const ticketEvents =
        activeTicketEventIds.length > 0
          ? await db.query.events.findMany({
              where: inArray(events.id, activeTicketEventIds),
            })
          : [];

      // 3. Merge + remove duplicates
      const eventsMap = new Map();
      [...organizerEvents, ...ticketEvents].forEach(event => {
        eventsMap.set(event.id, event);
      });

      // 4. Filter out events with chat disabled, then add expired flag
      const finalEvents = [...eventsMap.values()]
        .filter(event => event.isChatEnabled)
        .map(event => ({
          ...event,
          expired: event.endDate ? new Date(event.endDate) < now : false,
        }));

      return finalEvents;
    } catch (error) {
      console.error('Check chat access list error:', error);
      throw new ApiError(500, 'Failed to get accessible events');
    }
  }
  /**
   * Hard-delete a single chat room and all associated data (cascade)
   */
  static async deleteChatRoomCascade(chatRoomId) {
    return db.transaction(async (tx) => {
      // Reactions FK to messageId, not chatRoomId directly — so grab message
      // ids first, otherwise we can't target the right reaction rows.
      const roomMessages = await tx
        .select({ id: eventChatMessages.id })
        .from(eventChatMessages)
        .where(eq(eventChatMessages.eventChatRoomId, chatRoomId));

      const messageIds = roomMessages.map((m) => m.id);

      if (messageIds.length > 0) {
        await tx
          .delete(eventMessageReactions)
          .where(inArray(eventMessageReactions.messageId, messageIds));
      }

      await tx.delete(eventChatMessages).where(eq(eventChatMessages.eventChatRoomId, chatRoomId));
      await tx.delete(eventChatParticipants).where(eq(eventChatParticipants.eventChatRoomId, chatRoomId));
      await tx.delete(eventMessageReadReceipts).where(eq(eventMessageReadReceipts.eventChatRoomId, chatRoomId));
      await tx.delete(eventChatRooms).where(eq(eventChatRooms.id, chatRoomId));

      return { chatRoomId };
    });
  }

  /**
   * Find and hard-delete all event chat rooms for events that ended
   * more than 48 hours ago. Intended to be called from a cron job.
   */
  static async deleteExpiredEventChats() {
    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

      const expiredRooms = await db
        .select({
          chatRoomId: eventChatRooms.id,
          eventId: events.id,
          eventTitle: events.title,
        })
        .from(eventChatRooms)
        .innerJoin(events, eq(eventChatRooms.eventId, events.id))
        .where(lt(events.endDate, cutoff));

      const deleted = [];
      for (const room of expiredRooms) {
        await this.deleteChatRoomCascade(room.chatRoomId);
        deleted.push(room);
      }

      return deleted;
    } catch (error) {
      console.error('Delete expired event chats error:', error);
      throw new ApiError(500, 'Failed to delete expired event chats');
    }
  }
}
