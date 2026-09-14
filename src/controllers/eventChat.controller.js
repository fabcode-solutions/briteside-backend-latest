import { EventChatService } from '../services/eventChat.service.js';
import { catchAsync } from '../utils/catch-async.js';
import { emitEventChat } from '../socket/emitter.js';
import chalk from 'chalk';

/**
 * Fetch or create event chat room
 */
export const getEventChatRoom = catchAsync(async (req, res) => {
  const chatRoom = await EventChatService.getEventChatRoom(req.params.eventId, req.user.id);

  res.json({
    success: true,
    data: { chatRoom },
  });
});

/**
 * Send message to chat room + broadcast
 */
export const sendMessage = catchAsync(async (req, res) => {
  const message = await EventChatService.sendMessage(req.user.id, req.params.chatRoomId, req.body);

  // 🔥 Broadcast new message to everyone in the room via /event namespace
  const io = req.app.get('io');
  emitEventChat(io, req.params.chatRoomId, 'chat:new_message', {
    chatRoomId: req.params.chatRoomId,
    message,
  });

  res.status(201).json({
    success: true,
    message: 'Message sent successfully',
    data: { message },
  });
});

/**
 * Get paginated messages
 */
export const getMessages = catchAsync(async (req, res) => {
  const options = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 50,
    before: req.query.before,
    after: req.query.after,
  };

  const result = await EventChatService.getMessages(req.user.id, req.params.chatRoomId, options);

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Update message + broadcast update
 */
export const updateMessage = catchAsync(async (req, res) => {
  const message = await EventChatService.updateMessage(req.user.id, req.params.messageId, req.body);

  // 🔥 Broadcast message update via /event namespace
  const io = req.app.get('io');
  emitEventChat(io, message.eventChatRoomId, 'chat:message_updated', {
    messageId: req.params.messageId,
    message,
  });

  res.json({
    success: true,
    message: 'Message updated successfully',
    data: { message },
  });
});

/**
 * Mark messages as read + broadcast read receipt
 */
export const markAsRead = catchAsync(async (req, res) => {
  const result = await EventChatService.markAsRead(
    req.user.id,
    req.params.chatRoomId,
    req.body.messageId
  );

  // 🔥 Broadcast read status to others via /event namespace
  const io = req.app.get('io');
  emitEventChat(io, req.params.chatRoomId, 'chat:read', {
    chatRoomId: req.params.chatRoomId,
    userId: req.user.id,
    messageId: req.body.messageId,
  });

  res.json({
    success: true,
    message: 'Messages marked as read',
    data: result,
  });
});

/**
 * Add reaction to a message + broadcast reaction
 */
export const addReaction = catchAsync(async (req, res) => {
  const reaction = await EventChatService.addReaction(
    req.user.id,
    req.params.messageId,
    req.body.emoji
  );

  // 🔥 Broadcast added reaction via /event namespace
  const io = req.app.get('io');
  emitEventChat(io, reaction.chatRoomId || req.params.chatRoomId, 'chat:reaction_added', {
    messageId: req.params.messageId,
    emoji: req.body.emoji,
    userId: req.user.id,
    chatRoomId: reaction.chatRoomId, // optional, if available
  });

  res.json({
    success: true,
    message: 'Reaction added',
    data: { reaction },
  });
});

/**
 * Remove reaction + broadcast removal
 */
export const removeReaction = catchAsync(async (req, res) => {
  const result = await EventChatService.removeReaction(
    req.user.id,
    req.params.messageId,
    req.query.emoji
  );
  // 🔥 Broadcast reaction removal via /event namespace
  const io = req.app.get('io');
  emitEventChat(io, result.chatRoomId || req.params.chatRoomId, 'chat:reaction_removed', {
    messageId: req.params.messageId,
    emoji: req.query.emoji,
    userId: req.user.id,
    chatRoomId: result.chatRoomId, // optional, if available
  });

  res.json({
    success: true,
    message: 'Reaction removed',
    data: result,
  });
});

/**
 * Get chat participants (no socket needed)
 */
export const getParticipants = catchAsync(async (req, res) => {
  const options = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 50,
    role: req.query.role,
  };

  const result = await EventChatService.getParticipants(
    req.user.id,
    req.params.chatRoomId,
    options
  );

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Check if user can access event chat
 */
export const checkChatAccess = catchAsync(async (req, res) => {
  const access = await EventChatService.checkChatAccess(req.user.id, req.params.eventId);

  res.json({
    success: true,
    data: access,
  });
});

export const checkChatAccessList = catchAsync(async (req, res) => {
  const accessList = await EventChatService.checkChatAccessList(req.user.id);

  res.json({
    success: true,
    data: accessList,
  });
});
