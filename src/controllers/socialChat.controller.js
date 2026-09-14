import { catchAsync } from '../utils/catch-async.js';
import { SocialChatService } from '../services/socialChat.service.js';
import { emitSocialChat } from '../socket/emitter.js';
import { createNotification } from '../services/notification.service.js';
import { getUserInformation } from '../utils/helper.js';
import {
  TextModerationService,
  TEXT_ENTITY,
} from '../services/moderation/textModeration.service.js';

export const listConversations = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, type = 'general', conversationType } = req.query;
  const result = await SocialChatService.listConversations(req.user.id, {
    page: parseInt(page),
    limit: parseInt(limit),
    type,
    conversationType,
  });
  res.json({ success: true, data: result });
});

export const createOrGetConversation = catchAsync(async (req, res) => {
  const { userId, conversationType = 'social' } = req.body;
  const convo = await SocialChatService.getOrCreateConversation(
    req.user.id,
    userId,
    conversationType
  );
  res.status(201).json({ success: true, data: { conversation: convo } });

  const io = req.app.get('io');
  if (io) {
    const participants = [convo.userAId, convo.userBId].filter(Boolean);
    const [userA, userB] = await Promise.all([
      convo.userAId ? getUserInformation(convo.userAId) : null,
      convo.userBId ? getUserInformation(convo.userBId) : null,
    ]);

    for (const uid of participants) {
      const otherUser = uid === convo.userAId ? userB : userA;
      const secondUser = otherUser
        ? {
            id: otherUser.id,
            firstName: otherUser.firstName,
            lastName: otherUser.lastName,
            image: otherUser.image,
            username: otherUser.username,
            email: otherUser.email,
            lastSeen: otherUser.lastSeen,
            showOnlineStatus: otherUser.showOnlineStatus,
            showLastSeen: otherUser.showLastSeen,
          }
        : null;

      emitSocialChat(io, `user:${uid}`, 'social:conversation:upsert', {
        conversation: { ...convo, secondUser },
      });
    }
  }
});

export const getConversation = catchAsync(async (req, res) => {
  const convo = await SocialChatService.getConversation(req.user.id, req.params.conversationId);
  res.json({ success: true, data: { conversation: convo } });
});

export const deleteConversation = catchAsync(async (req, res) => {
  const result = await SocialChatService.deleteConversation(req.user.id, req.params.conversationId);
  res.json({ success: true, message: 'Conversation deleted', data: result });

  // Broadcast deletion to participants and room via /chat namespace
  const io = req.app.get('io');
  if (io) {
    try {
      const convo = await SocialChatService.getConversation(req.user.id, req.params.conversationId);
      const participants = [convo.userAId, convo.userBId].filter(Boolean);
      for (const uid of participants) {
        emitSocialChat(io, `user:${uid}`, 'social:conversation:deleted', {
          conversationId: req.params.conversationId,
        });
      }
    } catch (_) {
      // Conversation may already be deleted; still emit to room
    }
    emitSocialChat(
      io,
      `social:conversation:${req.params.conversationId}`,
      'social:conversation:deleted',
      { conversationId: req.params.conversationId }
    );
  }
});

export const getMessages = catchAsync(async (req, res) => {
  const { page = 1, limit = 50, priorityOnly, inquiryOnly } = req.query;
  const result = await SocialChatService.getMessages(req.user.id, req.params.conversationId, {
    page: parseInt(page),
    limit: parseInt(limit),
    priorityOnly: priorityOnly === 'true',
    inquiryOnly: inquiryOnly === 'true',
  });
  res.json({ success: true, data: result });
});

export const sendMessage = catchAsync(async (req, res) => {
  console.log(
    '[DEBUG]',
    req.method,
    req.originalUrl,
    '| io:',
    !!req.app.get('io'),
    '| settings:',
    Object.keys(req.app.settings || {})
  ); // ← ADD THIS LINE

  // Whitelist client-facing fields only — `skipModeration` is internal-only
  // (set by trusted server-to-server callers) and must never be settable
  // from a request body, or a client could grant themselves a bypass.
  const { messageType, content, metadata, replyToId, isPriority } = req.body;
  const message = await SocialChatService.sendMessage(req.user.id, req.params.conversationId, {
    messageType,
    content,
    metadata,
    replyToId,
    isPriority,
  });
  res.status(201).json({ success: true, message: 'Message sent', data: { message } });

  // ── Release priority payment per-item when talent replies ──────────────────
  try {
    const { PriorityMessageService } = await import('../services/priorityMessage.service.js');
    await PriorityMessageService.releaseOnReply(
      req.params.conversationId,
      req.user.id,
      req.body.replyToId ?? null,
      message.id
    );
  } catch (err) {
    console.warn('[sendMessage] releaseOnReply failed (non-fatal):', err.message);
  }

  // Real-time broadcast to conversation room and recipient via /chat namespace
  const io = req.app.get('io');
  if (io) {
    const convo = message.conversation
      ? message.conversation
      : await SocialChatService.getConversation(req.user.id, req.params.conversationId);
    const conversationId = convo.id || req.params.conversationId;
    const otherUserId = convo.userAId === req.user.id ? convo.userBId : convo.userAId;

    // Per-recipient delivery instead of one shared conversation-room broadcast —
    // that used to send the same (unmasked) message to both users, so a flagged
    // message showed raw text in real time until the next REST fetch re-applied
    // masking. Emitting to each user's own room lets the recipient's own
    // profanityFilterEnabled preference apply at delivery time. Each user's own
    // room is always joined on connect (see src/socket/index.js), independent
    // of whether the conversation room is also joined, so this remains exactly
    // one delivery per user — same invariant the old otherUserInConvo guard
    // below was protecting, just no longer tied to this emit.
    emitSocialChat(io, `user:${req.user.id}`, 'social:message:new', {
      conversationId,
      message,
    });

    if (otherUserId) {
      const recipientFilterEnabled = await TextModerationService.getFilterEnabled(otherUserId);
      const recipientMessage = await TextModerationService.maskFlaggedTextSingle(
        { ...message },
        {
          entityType: TEXT_ENTITY.MESSAGE,
          fields: ['content'],
          filterEnabled: recipientFilterEnabled,
        }
      );
      emitSocialChat(io, `user:${otherUserId}`, 'social:message:new', {
        conversationId,
        message: recipientMessage,
      });
    }

    try {
      const chatNamespace = io.of('/chat');
      const convoRoom = `social:conversation:${conversationId}`;
      const userRoom = `user:${otherUserId}`;

      const convoSockets = chatNamespace.adapter.rooms.get(convoRoom) || new Set();
      const userSockets = chatNamespace.adapter.rooms.get(userRoom) || new Set();

      let otherUserInConvo = false;
      for (const sid of userSockets) {
        if (convoSockets.has(sid)) {
          otherUserInConvo = true;
          break;
        }
      }

      if (!otherUserInConvo && otherUserId) {
        const senderName =
          (message.sender &&
            `${message.sender.firstName || ''} ${message.sender.lastName || ''}`.trim()) ||
          'New message';
        const contentPreview =
          message.messageType === 'text' && message.content
            ? String(message.content).trim().slice(0, 200)
            : null;

        const isCall = message.metadata?.callId || message.metadata?.callType;
        if (isCall) return;

        const body = contentPreview
          ? `replied in your conversation : ${contentPreview}`
          : 'Sent you a message';

        await createNotification({
          userId: otherUserId,
          title: `${senderName}`,
          message: body,
          type: 'chat_message',
          relatedId: conversationId,
          redirectTo: `/messages?conversationId=${conversationId}&tab=general`,
          metadata: {
            messageId: message.id,
            conversationId,
            senderId: message.senderId,
            actorUserId: message.senderId,
          },
        });
      }
    } catch (err) {
      console.warn('Failed to create in-app notification for chat message', err);
    }
  }
});

export const notifyMissedCall = catchAsync(async (req, res) => {
  const callerId = req.user.id;
  const { conversationId, callId, streamCallId } = req.body;

  const convo = await SocialChatService.getConversation(callerId, conversationId);
  const missedUserId = convo.userAId === callerId ? convo.userBId : convo.userAId;

  const caller = await getUserInformation(callerId);
  const callerName = `${caller?.firstName || ''} ${caller?.lastName || ''}`.trim() || 'Someone';

  await createNotification({
    userId: missedUserId,
    title: callerName,
    message: `📵 You missed a call from ${callerName}`,
    type: 'chat_message',
    relatedId: conversationId,
    redirectTo: `/messages?conversationId=${conversationId}&tab=general`,
    metadata: {
      conversationId,
      callId,
      streamCallId,
      actorUserId: callerId,
      callStatus: 'missed',
    },
  });

  res.json({ success: true });
});

export const markMessageSeen = catchAsync(async (req, res) => {
  const result = await SocialChatService.markMessageSeen(req.user.id, req.params.messageId);
  res.json({ success: true, message: 'Message marked as seen', data: result });

  // Notify sender and conversation room via /chat namespace
  const io = req.app.get('io');
  if (io) {
    const { conversationId, messageId, senderId } = result || {};
    if (conversationId) {
      emitSocialChat(io, `social:conversation:${conversationId}`, 'social:message:seen', {
        conversationId,
        messageId,
      });
    }
    if (senderId) {
      emitSocialChat(io, `user:${senderId}`, 'social:message:seen', {
        conversationId,
        messageId,
      });
    }
  }
});

export const deleteMessage = catchAsync(async (req, res) => {
  const result = await SocialChatService.deleteMessage(req.user.id, req.params.messageId);
  res.json({ success: true, message: 'Message deleted', data: result });

  // Broadcast deletion via /chat namespace
  const io = req.app.get('io');
  if (io) {
    const { conversationId } = result || {};
    if (conversationId) {
      emitSocialChat(io, `social:conversation:${conversationId}`, 'social:message:deleted', {
        conversationId,
        messageId: req.params.messageId,
      });
    }
  }
});

export const updateMessage = catchAsync(async (req, res) => {
  const result = await SocialChatService.updateMessage(req.user.id, req.params.messageId, req.body);
  res.json({ success: true, message: 'Message updated', data: result });

  // Broadcast update via /chat namespace
  const io = req.app.get('io');
  if (io) {
    const { conversationId } = result || {};
    if (conversationId) {
      emitSocialChat(io, `social:conversation:${conversationId}`, 'social:message:updated', {
        conversationId,
        messageId: req.params.messageId,
      });
    }
  }
});

export const sharePostToUsers = catchAsync(async (req, res) => {
  const { postId, userIds, message } = req.body;

  if (!postId) {
    return res.status(400).json({
      success: false,
      message: 'postId is required',
    });
  }

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'userIds must be a non-empty array',
    });
  }

  const result = await SocialChatService.sharePostToUsers(req.user.id, postId, userIds, message);

  res.status(200).json({
    success: true,
    message: `Post shared to ${result.successCount} out of ${result.totalRecipients} users`,
    data: result,
  });

  // Real-time notifications and broadcast via /chat namespace
  const io = req.app.get('io');
  if (io) {
    const sender = await getUserInformation(req.user.id);
    const senderName = sender
      ? `${sender.firstName || ''} ${sender.lastName || ''}`.trim() || sender.username
      : 'Someone';

    const contentType = result.contentType || 'post';
    const eventName =
      contentType === 'group'
        ? 'social:group:shared'
        : contentType === 'story'
          ? 'social:story:shared'
          : contentType === 'profile'
            ? 'social:profile:shared'
            : 'social:post:shared';
    const notifTitleVerb =
      contentType === 'group'
        ? 'shared a group'
        : contentType === 'story'
          ? 'shared a story'
          : contentType === 'profile'
            ? 'shared a profile'
            : 'shared a post';
    const notifType =
      contentType === 'group'
        ? 'group_share'
        : contentType === 'story'
          ? 'story_share'
          : contentType === 'profile'
            ? 'profile_share'
            : 'post_share';
    const defaultMessage =
      contentType === 'group'
        ? 'Shared a group with you'
        : contentType === 'story'
          ? 'Shared a story with you'
          : contentType === 'profile'
            ? 'Shared a profile with you'
            : 'Shared a post with you';

    // Notify each recipient who successfully received the shared content
    for (const resultItem of result.results) {
      if (resultItem.success) {
        const { userId: recipientId, conversationId, messageId, message: sharedMessage } = resultItem;

        // Same event a regular sent message gets, to both sender (multi-
        // device sync) and recipient — this is what makes the recipient's
        // inbox/conversation list update live instead of needing a refresh.
        if (sharedMessage) {
          emitSocialChat(io, `user:${req.user.id}`, 'social:message:new', {
            conversationId,
            message: sharedMessage,
          });
          emitSocialChat(io, `user:${recipientId}`, 'social:message:new', {
            conversationId,
            message: sharedMessage,
          });
        }

        // Real-time socket notification
        emitSocialChat(io, `user:${recipientId}`, eventName, {
          conversationId,
          messageId,
          postId,
          senderId: req.user.id,
        });

        // Always send in-app notification
        try {
          await createNotification({
            userId: recipientId,
            title: `${senderName} ${notifTitleVerb}`,
            message: message || defaultMessage,
            type: notifType,
            relatedId: postId,
            redirectTo: `/messages?conversationId=${conversationId}&tab=general`,
            metadata: {
              postId,
              contentType,
              conversationId,
              messageId,
              senderId: req.user.id,
              actorUserId: req.user.id,
            },
          });
        } catch (err) {
          console.warn('Failed to create notification for shared content', err);
        }
      }
    }
  }
});

export const shareDiscussionToUsers = catchAsync(async (req, res) => {
  const { discussionId, userIds, message } = req.body;

  if (!discussionId) {
    return res.status(400).json({
      success: false,
      message: 'discussionId is required',
    });
  }

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'userIds must be a non-empty array',
    });
  }

  const result = await SocialChatService.shareDiscussionToUsers(
    req.user.id,
    discussionId,
    userIds,
    message
  );

  res.status(200).json({
    success: true,
    message: `Discussion shared to ${result.successCount} out of ${result.totalRecipients} users`,
    data: result,
  });

  // Real-time notifications and broadcast via /chat namespace
  const io = req.app.get('io');
  if (io) {
    const sender = await getUserInformation(req.user.id);
    const senderName = sender
      ? `${sender.firstName || ''} ${sender.lastName || ''}`.trim() || sender.username
      : 'Someone';

    // Notify each recipient who successfully received the shared discussion
    for (const resultItem of result.results) {
      if (resultItem.success) {
        const { userId: recipientId, conversationId, messageId, message: sharedMessage } = resultItem;

        // Same event a regular sent message gets, to both sender (multi-
        // device sync) and recipient — this is what makes the recipient's
        // inbox/conversation list update live instead of needing a refresh.
        if (sharedMessage) {
          emitSocialChat(io, `user:${req.user.id}`, 'social:message:new', {
            conversationId,
            message: sharedMessage,
          });
          emitSocialChat(io, `user:${recipientId}`, 'social:message:new', {
            conversationId,
            message: sharedMessage,
          });
        }

        // Real-time socket notification
        emitSocialChat(io, `user:${recipientId}`, 'social:discussion:shared', {
          conversationId,
          messageId,
          discussionId,
          senderId: req.user.id,
        });

        // Always send in-app notification
        try {
          await createNotification({
            userId: recipientId,
            title: `${senderName} shared a discussion`,
            message: message || 'Shared a discussion with you',
            type: 'group_activity',
            relatedId: discussionId,
            redirectTo: `/messages?conversationId=${conversationId}&tab=general`,
            metadata: {
              discussionId,
              conversationId,
              messageId,
              senderId: req.user.id,
              actorUserId: req.user.id,
            },
          });
        } catch (err) {
          console.warn('Failed to create notification for shared discussion', err);
        }
      }
    }
  }
});
export const markAllSeen = catchAsync(async (req, res) => {
  const { conversationId } = req.params;
  const { isPriority, inquiryOnly } = req.body ?? {};

  const result = await SocialChatService.markAllSeenInConversation(
    req.user.id,
    conversationId,
    {
      ...(typeof isPriority === 'boolean' ? { isPriority } : {}),
      ...(inquiryOnly === true ? { inquiryOnly: true } : {}),
    }
  );

  if (result.markedCount > 0 && result.senderId) {
    const io = req.app.get('io');
    if (io) {
      const { emitSocialChat } = await import('../socket/emitter.js');
      for (const messageId of result.messageIds) {
        emitSocialChat(io, `user:${result.senderId}`, 'social:message:seen', {
          messageId,
          conversationId: result.conversationId,
        });
      }
    }
  }

  res.json({ success: true, data: result });
});
