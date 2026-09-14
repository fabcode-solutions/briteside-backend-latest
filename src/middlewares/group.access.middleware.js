import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { groups, groupMembers, discussions } from '../db/schema/groups.js';

/**
 * @param {("view"|"interact")} accessType
 * - "view" → just viewing discussions
 * - "interact" → posting/liking/replying
 */
export const groupAccessMiddleware = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.query?.userId || null;
    const discussionId =
      req.params?.discussionId || req.body?.discussionId || req.query?.discussionId;
    const groupId = req.params?.groupId || req.body?.groupId || req.query?.groupId;

    let discussion = null;
    let group = null;
    // console.log('Group Access Middleware Invoked:', discussionId, groupId, 'User:', userId);
    // 1️⃣ Fetch discussion (if discussionId present)
    if (discussionId) {
      const [fetchedDiscussion] = await db
        .select()
        .from(discussions)
        .where(eq(discussions.id, discussionId));
      if (!fetchedDiscussion) {
        return res.status(404).json({ success: false, message: 'Discussion not found.' });
      }
      discussion = fetchedDiscussion;
    }

    // 2️⃣ Determine group context
    const effectiveGroupId = discussion?.groupId || groupId;

    if (effectiveGroupId) {
      const [fetchedGroup] = await db.select().from(groups).where(eq(groups.id, effectiveGroupId));

      if (!fetchedGroup) {
        return res.status(404).json({ success: false, message: 'Group not found.' });
      }
      group = fetchedGroup;
    }

    // 3️⃣ Determine membership (if user logged in & group exists)
    let member = null;
    if (group && userId) {
      const [foundMember] = await db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, userId)));
      member = foundMember || null;
    }

    // 4️⃣ Core access logic
    if (!group) {
      // 🟢 Public discussion — full access
      req.access = { level: 'public', discussion, group: null, member: null };
      return next();
    }
    // 🟠 Group discussion — handle by group type
    if (!group.isPublic && !member) {
      // 🔒 Private group, non-member — no access
      return res.status(403).json({
        success: false,
        message: 'This is a private group. Join to view or participate.',
        allowJoin: true,
        groupVisibility: 'private',
      });
    }

    if (group.isPublic && !member) {
      // 👁 Public group, non-member — view only
      const isInteractionRoute = req.method !== 'GET';
      if (isInteractionRoute) {
        return res.status(403).json({
          success: false,
          message: 'Join this group to interact with discussions.',
          allowJoin: true,
          groupVisibility: 'public',
        });
      }

      // Allow view access
      req.access = { level: 'view-only', discussion, group, member: null };
      return next();
    }

    // ✅ Member — full access
    req.access = { level: 'full', discussion, group, member };
    return next();
  } catch (err) {
    console.error('Access check failed:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
