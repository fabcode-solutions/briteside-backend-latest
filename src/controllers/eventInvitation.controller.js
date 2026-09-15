import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { EventInvitationService } from '../services/social/eventInvitation.service.js';

export const inviteAllFollowers = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const organizerId = req.user.organizerId;
  const organizerUserId = req.user.id;

  if (!organizerId) {
    throw new ApiError(400, 'Organizer profile required');
  }

  const result = await EventInvitationService.inviteAllFollowers(
    eventId,
    organizerUserId,
    organizerId
  );

  res.status(200).json({ success: true, ...result });
});

export const getFollowerInviteStats = catchAsync(async (req, res) => {
  const { eventId } = req.params;

  const stats = await EventInvitationService.getInviteFollowersStats(eventId);

  // Nested under `data`, matching getBlastStats' shape — the frontend reads
  // res.data.stats for both, and Communication.tsx's fetchFollowersStats was
  // silently failing (caught, swallowed) because this used to be flat.
  res.status(200).json({ success: true, data: { stats } });
});
