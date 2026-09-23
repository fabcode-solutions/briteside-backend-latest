import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  startLivestream,
  endLivestream,
  getLivestream,
  getActiveLivestreams,
  getFollowingLivestreams,
  joinLivestream,
  checkConnection,
  leaveLivestream,
  addReaction,
  getReactionSummary,
  addComment,
  getComments,
  deleteComment,
  generateToken,
} from '../controllers/livestream.controller.js';

const router = express.Router();

// All livestream routes require authentication
router.use(authMiddleware);

// ─── Token ────────────────────────────────────────────────────────────────
// GET /livestream/token
router.get('/token', generateToken);

// ─── Discovery / Spotlight ────────────────────────────────────────────────
// GET /livestream/active          – all live streams (social tab spotlight)
router.get('/active', getActiveLivestreams);

// GET /livestream/following        – live streams from followed users
router.get('/following', getFollowingLivestreams);

// ─── Stream lifecycle ─────────────────────────────────────────────────────
// POST /livestream/start
router.post('/start', startLivestream);

// GET /livestream/:id
router.get('/:id', getLivestream);

// POST /livestream/:id/end
router.post('/:id/end', endLivestream);

// ─── Viewer tracking ──────────────────────────────────────────────────────
// POST /livestream/:id/join
router.post('/:id/join', joinLivestream);

// POST /livestream/:id/check-connection — duplicate-device guard, called by
// the host before joining their own broadcast (joinLivestream already
// covers viewers).
router.post('/:id/check-connection', checkConnection);

// POST /livestream/:id/leave
router.post('/:id/leave', leaveLivestream);

// ─── Reactions ────────────────────────────────────────────────────────────
// POST /livestream/:id/react
router.post('/:id/react', addReaction);

// GET /livestream/:id/reactions
router.get('/:id/reactions', getReactionSummary);

// ─── Comments ─────────────────────────────────────────────────────────────
// POST /livestream/:id/comments
router.post('/:id/comments', addComment);

// GET /livestream/:id/comments
router.get('/:id/comments', getComments);

// DELETE /livestream/comments/:commentId
router.delete('/comments/:commentId', deleteComment);

export default router;
