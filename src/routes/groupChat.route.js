import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { checkBlockedUrl } from '../middlewares/checkBlockedUrl.js';
import {
  getGroupChatRoom,
  sendGroupMessage,
  getGroupMessages,
  updateGroupMessage,
  markGroupChatAsRead,
  addGroupReaction,
  removeGroupReaction,
  getGroupChatParticipants,
  checkGroupChatAccess,
  checkGroupChatAccessList,
  deleteGroupMessage,
  blockGroupMember,
  unblockGroupMember,
} from '../controllers/groupChat.controller.js';

const router = express.Router();

// ── Access checks ──────────────────────────────────────────────────────────
router.get('/groups/:groupId/chat/access', authMiddleware, checkGroupChatAccess);
router.get('/groups/chat/accessList', authMiddleware, checkGroupChatAccessList);

// ── Chat room ───────────────────────────────────────────────────────────────
router.get('/groups/:groupId/chat', authMiddleware, getGroupChatRoom);

// ── Messages ────────────────────────────────────────────────────────────────
router.get('/group-chat-rooms/:chatRoomId/messages', authMiddleware, getGroupMessages);
router.post(
  '/group-chat-rooms/:chatRoomId/messages',
  authMiddleware,
  checkBlockedUrl('content', { optional: true, scanText: true }),
  sendGroupMessage
);
router.patch(
  '/group-chat-rooms/messages/:messageId',
  authMiddleware,
  checkBlockedUrl('content', { optional: true, scanText: true }),
  updateGroupMessage
);
router.post('/group-chat-rooms/:chatRoomId/read', authMiddleware, markGroupChatAsRead);
router.get('/group-chat-rooms/:chatRoomId/participants', authMiddleware, getGroupChatParticipants);

// ── Reactions ───────────────────────────────────────────────────────────────
router.post('/group-messages/:messageId/reactions', authMiddleware, addGroupReaction);
router.delete('/group-messages/:messageId/reactions', authMiddleware, removeGroupReaction);

router.delete('/group-chat-rooms/messages/:messageId', authMiddleware, deleteGroupMessage);
router.post('/groups/:groupId/chat/members/:userId/block', authMiddleware, blockGroupMember);
router.post('/groups/:groupId/chat/members/:userId/unblock', authMiddleware, unblockGroupMember);

export default router;
