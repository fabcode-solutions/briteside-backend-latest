import httpStatus from 'http-status';
import { userReports } from '../db/schema/userReports.js';
import { discussions, groupMembers, groups } from '../db/schema/index.js';
import { talentSessions } from '../db/schema/talentSessions.js';
import { talentProfiles } from '../db/schema/talentProfiles.js';
import ApiError from '../utils/api-error.js';
import { sql, eq, and, desc, asc } from 'drizzle-orm';
import { catchAsync } from '../utils/catch-async.js';
import { db } from '../db/index.js';
import { createNotification } from '../services/notification.service.js';
import {
  TextModerationService,
  TEXT_ENTITY,
} from '../services/moderation/textModeration.service.js';

const createReport = catchAsync(async (req, res) => {
  const {
    type,
    targetUserId,
    postId,
    groupId,
    eventId,
    discussionId,
    conversationId,
    commentId,
    discussionReplyId,
    talentSessionId,
    reason,
    description,
    metadata,
    evidenceImages,
  } = req.body;

  const reporterId = req.user.id;

  // ── Validate required target per type ────────────────────────────────────
  if (type === 'user' && !targetUserId)
    throw new ApiError(httpStatus.BAD_REQUEST, 'Target User ID is required for user reports');
  if (type === 'post' && !postId)
    throw new ApiError(httpStatus.BAD_REQUEST, 'Post ID is required for post reports');
  if (type === 'discussion' && !discussionId)
    throw new ApiError(httpStatus.BAD_REQUEST, 'Discussion ID is required for discussion reports');
  if (type === 'group' && !groupId)
    throw new ApiError(httpStatus.BAD_REQUEST, 'Group ID is required for group reports');
  if (type === 'event' && !eventId)
    throw new ApiError(httpStatus.BAD_REQUEST, 'Event ID is required for event reports');
  if (type === 'social_chat' && !conversationId)
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Conversation ID is required for social chat reports'
    );
  if (type === 'talent_session' && !talentSessionId)
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Talent session ID is required for talent session reports'
    );
  // `comment` covers both a post comment (commentId + postId) and a discussion
  // reply (discussionReplyId + discussionId) — same report shape, distinguished
  // by which pair is set. No new DB column: the specific id is stored in
  // `metadata` (reused, not a dedicated FK) to avoid a migration for this.
  if (type === 'comment') {
    if (!commentId && !discussionReplyId)
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'commentId or discussionReplyId is required for comment reports'
      );
    if (commentId && !postId)
      throw new ApiError(httpStatus.BAD_REQUEST, 'Post ID is required when reporting a comment');
    if (discussionReplyId && !discussionId)
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Discussion ID is required when reporting a discussion reply'
      );
  }

  // ── Authorize talent session reports (only the booker or the talent may report) ──
  if (type === 'talent_session' && talentSessionId) {
    const session = await db.query.talentSessions.findFirst({
      where: eq(talentSessions.id, talentSessionId),
      columns: { id: true, bookerId: true, talentProfileId: true },
    });
    if (!session) throw new ApiError(httpStatus.NOT_FOUND, 'Talent session not found');

    const talentProfile = await db.query.talentProfiles.findFirst({
      where: eq(talentProfiles.id, session.talentProfileId),
      columns: { userId: true },
    });

    const isParty =
      session.bookerId === reporterId || talentProfile?.userId === reporterId;
    if (!isParty)
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'Only the booker or talent on this session can report it'
      );
  }

  // ── Prevent duplicate reports (user reports allowed multiple times) ───────
  if (type !== 'user') {
    let existingReport;

    if (type === 'comment' && commentId) {
      existingReport = await db.query.userReports.findFirst({
        where: and(
          eq(userReports.reporterId, reporterId),
          eq(userReports.type, 'comment'),
          sql`${userReports.metadata}->>'commentId' = ${commentId}`
        ),
      });
    } else if (type === 'comment' && discussionReplyId) {
      existingReport = await db.query.userReports.findFirst({
        where: and(
          eq(userReports.reporterId, reporterId),
          eq(userReports.type, 'comment'),
          sql`${userReports.metadata}->>'discussionReplyId' = ${discussionReplyId}`
        ),
      });
    } else {
      if (postId)
        existingReport = await db.query.userReports.findFirst({
          where: and(eq(userReports.reporterId, reporterId), eq(userReports.postId, postId)),
        });

      if (!existingReport && discussionId)
        existingReport = await db.query.userReports.findFirst({
          where: and(
            eq(userReports.reporterId, reporterId),
            eq(userReports.discussionId, discussionId)
          ),
        });

      if (!existingReport && groupId)
        existingReport = await db.query.userReports.findFirst({
          where: and(eq(userReports.reporterId, reporterId), eq(userReports.groupId, groupId)),
        });

      if (!existingReport && eventId)
        existingReport = await db.query.userReports.findFirst({
          where: and(eq(userReports.reporterId, reporterId), eq(userReports.eventId, eventId)),
        });

      if (!existingReport && conversationId)
        existingReport = await db.query.userReports.findFirst({
          where: and(
            eq(userReports.reporterId, reporterId),
            eq(userReports.conversationId, conversationId)
          ),
        });

      if (!existingReport && talentSessionId)
        existingReport = await db.query.userReports.findFirst({
          where: and(
            eq(userReports.reporterId, reporterId),
            eq(userReports.talentSessionId, talentSessionId)
          ),
        });
    }

    if (existingReport)
      throw new ApiError(httpStatus.CONFLICT, 'You have already reported this content.');
  }

  // ── Insert report ─────────────────────────────────────────────────────────
  const mergedMetadata = {
    ...(metadata || {}),
    ...(commentId ? { commentId } : {}),
    ...(discussionReplyId ? { discussionReplyId } : {}),
  };

  const [report] = await db
    .insert(userReports)
    .values({
      reporterId,
      type,
      targetUserId,
      postId,
      discussionId,
      groupId,
      eventId,
      conversationId,
      talentSessionId,
      reason,
      description,
      metadata: mergedMetadata,
      evidenceImages,
      status: 'pending',
    })
    .returning();

  TextModerationService.flagAsync({
    entityType: TEXT_ENTITY.SUPPORT,
    entityId: report.id,
    entityCreatorId: reporterId,
    texts: [reason, description],
  });

  // ── Notify group organizer when a discussion is reported ──────────────────
  if (type === 'discussion' && discussionId) {
    try {
      const discussion = await db.query.discussions.findFirst({
        where: eq(discussions.id, discussionId),
        columns: { id: true, title: true, groupId: true, userId: true },
      });

      if (discussion?.groupId) {
        // Find the group admin (organizer)
        const [organizer] = await db
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.groupId, discussion.groupId),
              eq(groupMembers.role, 'admin'),
              eq(groupMembers.status, 'joined')
            )
          )
          .limit(1);

        const group = await db.query.groups.findFirst({
          where: eq(groups.id, discussion.groupId),
          columns: { slug: true, name: true },
        });

        // Notify organizer — but not if they were the one who filed the report
        if (organizer && organizer.userId !== reporterId && group) {
          await createNotification({
            userId: organizer.userId,
            title: '⚠️ Discussion Reported',
            message: `A discussion "${discussion.title}" in your group "${group.name}" was reported for: ${reason}`,
            type: 'group_activity',
            relatedId: discussion.groupId,
            redirectTo: `/groups/${group.slug}`,
            metadata: {
              reportId: report.id,
              discussionId,
              reportReason: reason,
              groupId: discussion.groupId,
            },
          });
        }
      }
    } catch (notifyError) {
      // Notification failure must never block the report submission
      console.error('Failed to notify group organizer about reported discussion:', notifyError);
    }
  }

  res.status(httpStatus.CREATED).send(report);
});

const getReports = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 100,
    status,
    type,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];

  if (status) conditions.push(eq(userReports.status, status));
  if (type) conditions.push(eq(userReports.type, type));

  const reports = await db.query.userReports.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    limit: Number(limit),
    offset,
    orderBy: [sortOrder === 'asc' ? asc(userReports[sortBy]) : desc(userReports[sortBy])],
    with: {
      reporter: {
        columns: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          image: true,
        },
      },
      targetUser: {
        columns: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          image: true,
        },
      },
      post: {
        columns: { id: true, caption: true, mediaUrls: true, mediaTypes: true },
      },
      group: {
        columns: { id: true, name: true, slug: true },
      },
      event: {
        columns: { id: true, title: true, slug: true },
      },
      socialConversation: {
        columns: { id: true, userAId: true, userBId: true },
        with: {
          userA: {
            columns: { id: true, username: true, firstName: true, lastName: true, image: true },
          },
          userB: {
            columns: { id: true, username: true, firstName: true, lastName: true, image: true },
          },
        },
      },
      discussion: {
        columns: { id: true, title: true, groupId: true },
      },
    },
  });

  // Total count for pagination
  const [{ count: total }] = await db
    .select({ count: sql`count(*)` })
    .from(userReports)
    .where(conditions.length ? and(...conditions) : undefined);

  res.send({
    results: reports,
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    pages: Math.ceil(Number(total) / Number(limit)),
  });
});

const updateReportStatus = catchAsync(async (req, res) => {
  const { reportId } = req.params;
  const { status, actionTaken } = req.body;

  const [updatedReport] = await db
    .update(userReports)
    .set({
      status,
      actionTaken,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
    })
    .where(eq(userReports.id, reportId))
    .returning();

  if (!updatedReport) throw new ApiError(httpStatus.NOT_FOUND, 'Report not found');

  res.send(updatedReport);
});

export const reportController = {
  createReport,
  getReports,
  updateReportStatus,
};
