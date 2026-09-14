import { StreamCallService, streamClient } from '../services/stream.service.js';
import { catchAsync } from '../utils/catch-async.js';
import { randomUUID } from 'crypto';
import { FollowService } from '../services/social/follow.service.js';
import { getUserInformation } from '../utils/helper.js';
import * as userService from '../services/user.service.js';
import ApiError from '../utils/api-error.js';
export const createCall = catchAsync(async (req, res) => {
  const { cid, type, starts_at, backstage, members, custom } = req.body;
  const created_by_user_id = req.user.id;
  const call = await StreamCallService.createCall({
    cid,
    type,
    created_by_user_id,
    starts_at,
    backstage,
    members,
    custom,
  });
  res.status(201).json({ success: true, data: { call } });
});

export const updateCallStatus = catchAsync(async (req, res) => {
  const { ongoing, ended_at } = req.body;
  const updated_at = new Date();
  const call = await StreamCallService.updateCallStatus(req.params.id, {
    ongoing,
    ended_at,
    updated_at,
  });
  res.json({ success: true, data: { call } });
});

export const logCallEvent = catchAsync(async (req, res) => {
  const event = req.body;
  const call = await StreamCallService.logCallEvent(req.params.id, event);
  res.json({ success: true, data: { call } });
});

export const initiateCall = catchAsync(async (req, res) => {
  const { callType = 'default', members = [], custom = {}, callId: bodyCallId } = req.body;
  const created_by_user_id = req.user.id;
  const callId = bodyCallId || randomUUID();

  // Build members array with current user as admin/host
  const callMembers = [
    { user_id: created_by_user_id, role: callType === 'default' ? 'admin' : 'host' },
    ...members.map(member => ({
      user_id: member.user_id,
      role: member.role || 'user',
    })),
  ];

  // For livestreams, fetch the creator's followers and add them as members
  // if (callType === 'livestream') {
  //   const followers = await FollowService.getFollowers(
  //     created_by_user_id,
  //     1,
  //     Number.MAX_SAFE_INTEGER
  //   );
  //   const followerMembers = followers.map(f => ({ user_id: f.id, role: 'user' }));
  //   callMembers.push(...followerMembers);
  // }

  // Create call via Stream SDK and store in DB
  const recipientUserId = members[0]?.user_id;
  let recipientName = 'Unknown';
  let recipientImage = '';

  if (recipientUserId) {
    const recipientUser = await getUserInformation(recipientUserId);
    recipientName = recipientUser?.name || 'Unknown';
    recipientImage = recipientUser?.image || '';
  }

  // Enforce the recipient's incoming-call privacy setting (1:1 calls only).
  if (recipientUserId && callType === 'default') {
    const recipient = await userService.getUserById(recipientUserId);
    const allowCallsFrom = recipient?.allowCallsFrom ?? 'everyone';
    if (allowCallsFrom === 'nobody') {
      throw new ApiError(403, 'This user is not accepting calls');
    }
    if (allowCallsFrom === 'following') {
      const recipientFollowsCaller = await FollowService.isFollowing(
        recipientUserId,
        created_by_user_id
      );
      if (!recipientFollowsCaller) {
        throw new ApiError(403, 'You can only call this user if they follow you');
      }
    }
  }
  const call = await StreamCallService.initiateCall({
    cid: callId,
    type: callType,
    created_by_user_id,
    members: callMembers,
    custom: {
      ...custom,
      recipientName,
      recipientImage,
    },
    callId,
  });

  res.status(201).json({ success: true, data: { call } });
});

export const generateToken = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const token = await StreamCallService.generateToken(userId);
  res.json({ success: true, data: { token } });
});

export const getCallById = catchAsync(async (req, res) => {
  const { cid } = req.params;
  const call = await StreamCallService.getCall(cid);
  res.json({ success: true, data: { call } });
});

// Public — for demo participants who don't have an account
export const generateGuestToken = catchAsync(async (req, res) => {
  const { userId, name } = req.body;
  if (!userId || !name) {
    return res.status(400).json({ error: 'userId and name are required' });
  }

  await streamClient.upsertUsers([{ id: userId, name, role: 'user' }]);
  const token = streamClient.generateUserToken({ user_id: userId });

  res.json({ success: true, data: { token, userId } });
});
