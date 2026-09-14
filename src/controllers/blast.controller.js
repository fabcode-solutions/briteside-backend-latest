import { BlastService } from '../services/blast.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

export const sendSmsBlast = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const { message } = req.body;

  if (!message?.trim()) throw new ApiError(400, 'message is required');

  const blast = await BlastService.sendSmsBlast({
    eventId,
    message: message.trim(),
    sentBy: req.user?.id || null,
    sentByTeamMember: req.teamMember?.id || null,
  });

  res.status(202).json({ success: true, data: { blast } });
});

export const sendEmailBlast = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const { subject, message } = req.body;

  if (!message?.trim()) throw new ApiError(400, 'message is required');

  const blast = await BlastService.sendEmailBlast({
    eventId,
    subject: subject?.trim() || null,
    message: message.trim(),
    sentBy: req.user?.id || null,
    sentByTeamMember: req.teamMember?.id || null,
  });

  res.status(202).json({ success: true, data: { blast } });
});

export const listBlasts = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const blasts = await BlastService.listBlasts(eventId, { page, limit });

  res.json({ success: true, data: { blasts } });
});

export const getBlastStats = catchAsync(async (req, res) => {
  const { eventId } = req.params;
  const stats = await BlastService.getBlastStats(eventId);
  res.json({ success: true, data: { stats } });
});
