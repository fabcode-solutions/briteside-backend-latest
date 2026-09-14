import { OrganizerService } from '../services/organizer.service.js';
import { OrganizerMemberService } from '../services/organizerMember.service.js';
import { OrganizerProfileService } from '../services/organizerProfile.service.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';

export const createOrganizer = catchAsync(async (req, res) => {
  const organizer = await OrganizerService.createOrganizer(req.user.id, req.body);

  res.status(201).json({
    success: true,
    message: 'Organizer created successfully',
    data: { organizer },
  });
});

export const getOrganizers = catchAsync(async (req, res) => {
  const organizers = await OrganizerService.getOrganizers();

  res.json({
    success: true,
    data: { organizers },
  });
});

export const getOrganizerProfile = catchAsync(async (req, res) => {
  const profile = await OrganizerService.getOrganizerProfile(req.user.id);

  res.json({
    success: true,
    data: { profile },
  });
});

export const updateOrganizerProfile = catchAsync(async (req, res) => {
  const profile = await OrganizerService.updateOrganizerProfile(req.user.id, req.body);

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { profile },
  });
});

export const createMember = catchAsync(async (req, res) => {
  const { organizerId, memberData } = req.body;

  if (!organizerId || !memberData) {
    throw new ApiError(400, 'Missing required data');
  }

  const result = await OrganizerMemberService.createMember(organizerId, req.user.id, memberData);

  res.status(201).json({
    success: true,
    message: 'Member created successfully',
    data: {
      member: result.member,
      user: result.user,
      credentials: result.credentials,
    },
  });
});

export const getOrganizerMembers = catchAsync(async (req, res) => {
  const { organizerId } = req.query;

  if (!organizerId) {
    throw new ApiError(400, 'Organizer ID required');
  }

  const members = await OrganizerMemberService.getOrganizerMembers(organizerId, req.user.id);

  res.json({
    success: true,
    data: { members },
  });
});

export const getMember = catchAsync(async (req, res) => {
  const { organizerId } = req.query;
  const { memberId } = req.params;

  if (!organizerId) throw new ApiError(400, 'Organizer ID required');

  const member = await OrganizerProfileService.getMember(organizerId, memberId, req.user.id);

  res.json({ success: true, data: { member } });
});

export const updateMember = catchAsync(async (req, res) => {
  const { organizerId } = req.body;
  const { memberId } = req.params;
  const updates = req.body.updates || {};

  if (!organizerId) throw new ApiError(400, 'Organizer ID required');

  const member = await OrganizerProfileService.updateMember(
    organizerId,
    memberId,
    updates,
    req.user.id
  );

  res.json({ success: true, message: 'Member updated', data: { member } });
});

export const updateMemberStatus = catchAsync(async (req, res) => {
  const { organizerId, isActive } = req.body;
  const { memberId } = req.params;

  if (!organizerId || typeof isActive !== 'boolean') {
    throw new ApiError(400, 'organizerId and isActive(boolean) are required');
  }

  const updated = await OrganizerProfileService.updateMemberStatus(organizerId, memberId, isActive);

  res.json({
    success: true,
    message: 'Member status updated',
    data: { updated },
  });
});

export const regenerateMemberPassword = catchAsync(async (req, res) => {
  const { organizerId, customPassword } = req.body;
  const { memberId } = req.params;

  if (!organizerId) throw new ApiError(400, 'Organizer ID required');

  const result = await OrganizerProfileService.regeneratePassword(
    organizerId,
    memberId,
    customPassword || null
  );

  res.json({ success: true, message: 'Password regenerated', data: result });
});

export const deleteMember = catchAsync(async (req, res) => {
  const { organizerId } = req.body;
  const { memberId } = req.params;

  if (!organizerId) throw new ApiError(400, 'Organizer ID required');

  await OrganizerProfileService.deleteMember(organizerId, memberId);

  res.json({ success: true, message: 'Member deleted' });
});
