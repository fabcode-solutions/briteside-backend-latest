import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  listConversations,
  createOrGetConversation,
  getConversation,
  deleteConversation,
  getMessages,
  sendMessage,
  markMessageSeen,
  deleteMessage,
  updateMessage,
  sharePostToUsers,
  shareDiscussionToUsers,
  notifyMissedCall,
  markAllSeen,
} from '../controllers/socialChat.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Conversations
router.get('/conversations', listConversations);
router.post('/conversations', createOrGetConversation);
router.get('/conversations/:conversationId', getConversation);
router.delete('/conversations/:conversationId', deleteConversation);

// Share post to users
router.post('/share-post', sharePostToUsers);

// Share discussion to users
router.post('/share-discussion', shareDiscussionToUsers);

// Messages
router.get('/conversations/:conversationId/messages', getMessages);
router.post(
  '/conversations/:conversationId/messages',
  checkBlockedUrl('content', { optional: true, scanText: true }),
  sendMessage
);
router.patch(
  '/conversations/messages/:messageId',
  checkBlockedUrl('content', { optional: true, scanText: true }),
  updateMessage
);
router.post('/messages/:messageId/seen', markMessageSeen);
router.delete('/messages/:messageId', deleteMessage);
router.post('/calls/missed', notifyMissedCall);
router.post('/conversations/:conversationId/seen', authMiddleware, markAllSeen);
export default router;
