import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  getEventChatRoom,
  sendMessage,
  getMessages,
  markAsRead,
  addReaction,
  removeReaction,
  getParticipants,
  checkChatAccess,
  checkChatAccessList,
} from '../controllers/eventChat.controller.js';
import { updateMessage } from '../controllers/eventChat.controller.js';

const router = express.Router();

// Event chat access
router.get('/events/:eventId/chat/access', authMiddleware, checkChatAccess);
router.get('/events/chat/accessList', authMiddleware, checkChatAccessList);
router.get('/events/:eventId/chat', authMiddleware, getEventChatRoom);

// Chat room operations
router.get('/chat-rooms/:chatRoomId/messages', authMiddleware, getMessages);
router.post(
  '/chat-rooms/:chatRoomId/messages',
  authMiddleware,
  checkBlockedUrl('content', { optional: true, scanText: true }),
  sendMessage
);
router.patch(
  '/chat-rooms/messages/:messageId',
  authMiddleware,
  checkBlockedUrl('content', { optional: true, scanText: true }),
  updateMessage
);
router.post('/chat-rooms/:chatRoomId/read', authMiddleware, markAsRead);
router.get('/chat-rooms/:chatRoomId/participants', authMiddleware, getParticipants);

// Message reactions
router.post('/messages/:messageId/reactions', authMiddleware, addReaction);
router.delete('/messages/:messageId/reactions', authMiddleware, removeReaction);

export default router;
