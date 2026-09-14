import { EventLikeService } from '../services/eventLike.service.js';
import { catchAsync } from '../utils/catch-async.js';

export const toggleEventLike = catchAsync(async (req, res) => {
  const result = await EventLikeService.toggleLike(req.user.id, req.params.eventId);

  res.json({
    success: true,
    message: result.isLiked ? 'Event liked' : 'Event unliked',
    data: result,
  });
});

export const getEventLikeStatus = catchAsync(async (req, res) => {
  const result = await EventLikeService.getUserLikeStatus(req.user.id, req.params.eventId);

  res.json({
    success: true,
    data: result,
  });
});
