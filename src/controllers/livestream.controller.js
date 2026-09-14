import { LivestreamService } from '../services/livestream.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { StreamCallService } from '../services/stream.service.js';
import { emitLivestreamUpdate } from '../socket/emitter.js';

// ─── POST /livestream/start ───────────────────────────────────────────────
export const startLivestream = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { title, description, allowComments } = req.body;

  if (!title?.trim()) throw new ApiError(400, 'Title is required.');

  const result = await LivestreamService.startLivestream({
    userId,
    title: title.trim(),
    description,
    allowComments,
  });

  if (!result.alreadyLive) {
    const io = req.app.get('io');
    emitLivestreamUpdate(io, 'livestream:started', { stream: result.stream });
  }

  const statusCode = result?.alreadyLive ? 200 : 201;
  res.status(statusCode).json({ success: true, data: result });
});

// ─── POST /livestream/:id/end ─────────────────────────────────────────────
export const endLivestream = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id: livestreamId } = req.params;

  const stream = await LivestreamService.endLivestream({ livestreamId, userId });

  const io = req.app.get('io');
  emitLivestreamUpdate(io, 'livestream:ended', { streamId: stream.id });

  res.json({ success: true, data: { stream } });
});

// ─── GET /livestream/:id ──────────────────────────────────────────────────
export const getLivestream = catchAsync(async (req, res) => {
  const { id } = req.params;
  const stream = await LivestreamService.getLivestream(id, req.user.id);
  res.json({ success: true, data: { stream } });
});

// ─── GET /livestream/active ───────────────────────────────────────────────
// All currently live streams (social tab spotlight)
export const getActiveLivestreams = catchAsync(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const streams = await LivestreamService.getActiveLivestreams({
    page: Number(page),
    limit: Number(limit),
    viewerId: req.user.id,
  });
  res.json({ success: true, data: { streams } });
});

// ─── GET /livestream/following ────────────────────────────────────────────
// Live streams from users the authenticated user follows
export const getFollowingLivestreams = catchAsync(async (req, res) => {
  const viewerId = req.user.id;
  const streams = await LivestreamService.getFollowingLivestreams(viewerId);
  res.json({ success: true, data: { streams } });
});

// ─── POST /livestream/:id/join ────────────────────────────────────────────
export const joinLivestream = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id: livestreamId } = req.params;
  const result = await LivestreamService.joinLivestream({ livestreamId, userId });
  res.json({ success: true, data: result });
});

// ─── POST /livestream/:id/leave ───────────────────────────────────────────
export const leaveLivestream = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id: livestreamId } = req.params;
  await LivestreamService.leaveLivestream({ livestreamId, userId });
  res.json({ success: true });
});

// ─── POST /livestream/:id/react ───────────────────────────────────────────
export const addReaction = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id: livestreamId } = req.params;
  const { emoji } = req.body;

  if (!emoji) throw new ApiError(400, 'Emoji is required.');

  const reaction = await LivestreamService.addReaction({ livestreamId, userId, emoji });
  res.status(201).json({ success: true, data: { reaction } });
});

// ─── GET /livestream/:id/reactions ───────────────────────────────────────
export const getReactionSummary = catchAsync(async (req, res) => {
  const { id: livestreamId } = req.params;
  const summary = await LivestreamService.getReactionSummary(livestreamId);
  res.json({ success: true, data: { reactions: summary } });
});

// ─── POST /livestream/:id/comments ───────────────────────────────────────
export const addComment = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id: livestreamId } = req.params;
  const { text } = req.body;

  const comment = await LivestreamService.addComment({ livestreamId, userId, text });
  res.status(201).json({ success: true, data: { comment } });
});

// ─── GET /livestream/:id/comments ────────────────────────────────────────
export const getComments = catchAsync(async (req, res) => {
  const { id: livestreamId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  const comments = await LivestreamService.getComments({
    livestreamId,
    page: Number(page),
    limit: Number(limit),
    viewerId: req.user.id,
  });
  res.json({ success: true, data: { comments } });
});

// ─── DELETE /livestream/comments/:commentId ───────────────────────────────
export const deleteComment = catchAsync(async (req, res) => {
  const requesterId = req.user.id;
  const { commentId } = req.params;
  await LivestreamService.deleteComment({ commentId, requesterId });
  res.json({ success: true, message: 'Comment deleted.' });
});

// ─── GET /livestream/token ────────────────────────────────────────────────
export const generateToken = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const token = await StreamCallService.generateToken(userId);
  res.json({ success: true, data: { token } });
});
