import { GroupChatService } from '../services/groupChat.service.js';
import { catchAsync } from '../utils/catch-async.js';
import { emitGroupChat, emitSocialChat } from '../socket/emitter.js';
import { createNotification } from '../services/notification.service.js';
import { getUserInformation } from '../utils/helper.js';

export const getGroupChatRoom = catchAsync(async (req, res) => {
  const chatRoom = await GroupChatService.getGroupChatRoom(req.params.groupId, req.user.id);
  res.json({ success: true, data: { chatRoom } });
});

export const getGroupMessages = catchAsync(async (req, res) => {
  const options = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 50,
    before: req.query.before,
    after: req.query.after,
  };
  const result = await GroupChatService.getMessages(req.user.id, req.params.chatRoomId, options);
  res.json({ success: true, data: result });
});

export const updateGroupMessage = catchAsync(async (req, res) => {
  const message = await GroupChatService.updateMessage(req.user.id, req.params.messageId, req.body);

  const io = req.app.get('io');
  emitGroupChat(io, message.groupChatRoomId, 'chat:message_updated', {
    messageId: req.params.messageId,
    message,
  });

  res.json({ success: true, message: 'Message updated successfully', data: { message } });
});

export const markGroupChatAsRead = catchAsync(async (req, res) => {
  const result = await GroupChatService.markAsRead(
    req.user.id,
    req.params.chatRoomId,
    req.body.messageId
  );

  const io = req.app.get('io');
  emitGroupChat(io, req.params.chatRoomId, 'chat:read', {
    chatRoomId: req.params.chatRoomId,
    userId: req.user.id,
    messageId: req.body.messageId,
  });

  res.json({ success: true, message: 'Messages marked as read', data: result });
});

export const addGroupReaction = catchAsync(async (req, res) => {
  const reaction = await GroupChatService.addReaction(
    req.user.id,
    req.params.messageId,
    req.body.emoji
  );

  const io = req.app.get('io');
  emitGroupChat(io, reaction.chatRoomId || req.params.chatRoomId, 'chat:reaction_added', {
    messageId: req.params.messageId,
    emoji: req.body.emoji,
    userId: req.user.id,
    chatRoomId: reaction.chatRoomId,
  });

  res.json({ success: true, message: 'Reaction added', data: { reaction } });
});

export const removeGroupReaction = catchAsync(async (req, res) => {
  const result = await GroupChatService.removeReaction(
    req.user.id,
    req.params.messageId,
    req.query.emoji
  );

  const io = req.app.get('io');
  emitGroupChat(io, result.chatRoomId || req.params.chatRoomId, 'chat:reaction_removed', {
    messageId: req.params.messageId,
    emoji: req.query.emoji,
    userId: req.user.id,
    chatRoomId: result.chatRoomId,
  });

  res.json({ success: true, message: 'Reaction removed', data: result });
});

export const getGroupChatParticipants = catchAsync(async (req, res) => {
  const options = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 50,
    role: req.query.role,
  };
  const result = await GroupChatService.getParticipants(
    req.user.id,
    req.params.chatRoomId,
    options
  );
  res.json({ success: true, data: result });
});

export const checkGroupChatAccess = catchAsync(async (req, res) => {
  const access = await GroupChatService.checkChatAccess(req.user.id, req.params.groupId);
  res.json({ success: true, data: access });
});

export const checkGroupChatAccessList = catchAsync(async (req, res) => {
  const accessList = await GroupChatService.checkChatAccessList(req.user.id);
  res.json({ success: true, data: accessList });
});

export const sendGroupMessage = catchAsync(async (req, res) => {
  const message = await GroupChatService.sendMessage(req.user.id, req.params.chatRoomId, req.body);

  const io = req.app.get('io');
  emitGroupChat(io, req.params.chatRoomId, 'chat:new_message', {
    chatRoomId: req.params.chatRoomId,
    message,
  });

  res.status(201).json({
    success: true,
    message: 'Message sent successfully',
    data: { message },
  });

  // ── Push the same update into each member's inbox (/chat namespace) ──────
  let thisRoom;
  let participantsForNotify = [];
  try {
    const inboxItems = await GroupChatService.listGroupChatsForUser.call(
      GroupChatService,
      req.user.id
    );
    thisRoom = inboxItems.find(item => item.id === req.params.chatRoomId);
    if (thisRoom && io) {
      const participants = await GroupChatService.getParticipants(
        req.user.id,
        req.params.chatRoomId,
        {
          limit: 1000,
        }
      );
      // IMPORTANT: exclude blocked members — getParticipants now returns
      // 'joined' + 'blocked' so organizers can manage blocks, but blocked
      // users must not receive inbox updates or notifications for this group.
      participantsForNotify = participants.participants.filter(p => p.status !== 'blocked');
      for (const p of participantsForNotify) {
        emitSocialChat(io, `user:${p.userId}`, 'social:conversation:upsert', {
          conversation: thisRoom,
        });
      }
    }
  } catch (err) {
    console.warn('[sendGroupMessage] inbox upsert emit failed (non-fatal):', err.message);
  }

  // ── Notify every other joined (non-blocked) member ─────────────────────────
  try {
    if (io) {
      let participants = participantsForNotify;
      if (!participants.length) {
        const res2 = await GroupChatService.getParticipants(req.user.id, req.params.chatRoomId, {
          limit: 1000,
        });
        participants = res2.participants.filter(p => p.status !== 'blocked');
      }

      const recipients = participants.filter(p => p.userId !== req.user.id);

      if (recipients.length > 0) {
        const sender = await getUserInformation(req.user.id);
        const senderName =
          (sender && `${sender.firstName || ''} ${sender.lastName || ''}`.trim()) || 'Someone';

        const isCall = message.metadata?.callId || message.metadata?.callType;
        const contentPreview =
          !isCall && message.messageType === 'text' && message.content
            ? String(message.content).trim().slice(0, 200)
            : null;

        const body = contentPreview
          ? `${senderName} in group chat: ${contentPreview}`
          : `${senderName} sent a message in group chat`;

        const chatNamespace = io.of('/chat');
        const roomSockets = chatNamespace.adapter.rooms.get(req.params.chatRoomId) || new Set();

        for (const p of recipients) {
          if (isCall) continue;

          const userRoom = `user:${p.userId}`;
          const userSockets = chatNamespace.adapter.rooms.get(userRoom) || new Set();
          let recipientInRoom = false;
          for (const sid of userSockets) {
            if (roomSockets.has(sid)) {
              recipientInRoom = true;
              break;
            }
          }
          if (recipientInRoom) continue;

          await createNotification({
            userId: p.userId,
            title: senderName,
            message: body,
            type: 'group_chat_message',
            relatedId: req.params.chatRoomId,
            redirectTo: `/messages?tab=general&conversationId=${req.params.chatRoomId}`,
            metadata: {
              messageId: message.id,
              chatRoomId: req.params.chatRoomId,
              senderId: req.user.id,
              actorUserId: req.user.id,
            },
          });
        }
      }
    }
  } catch (err) {
    console.warn('[sendGroupMessage] notification dispatch failed (non-fatal):', err.message);
  }
});

export const deleteGroupMessage = catchAsync(async (req, res) => {
  const result = await GroupChatService.deleteMessage(req.user.id, req.params.messageId);

  const io = req.app.get('io');
  emitGroupChat(io, result.chatRoomId, 'chat:message_deleted', {
    messageId: req.params.messageId,
    chatRoomId: result.chatRoomId,
    deletedBy: req.user.id,
  });

  res.json({ success: true, message: 'Message deleted successfully', data: result });
});

export const blockGroupMember = catchAsync(async (req, res) => {
  const result = await GroupChatService.blockMember(
    req.user.id,
    req.params.groupId,
    req.params.userId,
    req.body
  );

  const io = req.app.get('io');
  const payload = {
    groupId: req.params.groupId,
    userId: req.params.userId,
    blockedBy: req.user.id,
    chatRoomId: result.chatRoomId,
  };

  if (result.chatRoomId) {
    emitGroupChat(io, result.chatRoomId, 'chat:member_blocked', payload);
  }
  // Also deliver directly to the blocked user's own room, in case their
  // socket isn't currently joined to the chat room (e.g. on inbox screen).
  if (io) {
    emitSocialChat(io, `user:${req.params.userId}`, 'chat:member_blocked', payload);
  }

  try {
    await createNotification({
      userId: req.params.userId,
      title: 'Group access removed',
      message: 'You have been blocked from this group chat by an organizer.',
      type: 'group_member_blocked',
      relatedId: req.params.groupId,
      metadata: { groupId: req.params.groupId, actorUserId: req.user.id },
    });
  } catch (err) {
    console.warn('[blockGroupMember] notification dispatch failed (non-fatal):', err.message);
  }

  res.json({ success: true, message: 'Member blocked from group chat', data: result });
});

export const unblockGroupMember = catchAsync(async (req, res) => {
  const result = await GroupChatService.unblockMember(
    req.user.id,
    req.params.groupId,
    req.params.userId
  );

  const io = req.app.get('io');
  const payload = {
    groupId: req.params.groupId,
    userId: req.params.userId,
    unblockedBy: req.user.id,
  };

  if (io) {
    emitSocialChat(io, `user:${req.params.userId}`, 'chat:member_unblocked', payload);
  }

  res.json({ success: true, message: 'Member unblocked', data: result });
});
