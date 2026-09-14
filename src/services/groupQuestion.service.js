import { db } from '../db/index.js';
import {
  groupQuestions,
  groupJoinRequests,
  groupMembers,
  groups,
  users,
} from '../db/schema/index.js';
import { eq, and, asc, desc } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import { requireGroupAdmin, requireGroupAdminOrModerator } from '../utils/group-helpers.js';
import { getUserInformation } from '../utils/helper.js';

export class GroupQuestionService {
  static async getQuestions(groupId) {
    return db
      .select()
      .from(groupQuestions)
      .where(and(eq(groupQuestions.groupId, groupId), eq(groupQuestions.isActive, true)))
      .orderBy(asc(groupQuestions.sortOrder), asc(groupQuestions.createdAt));
  }

  static async createQuestion(groupId, userId, data) {
    await requireGroupAdmin(groupId, userId);

    const [question] = await db
      .insert(groupQuestions)
      .values({
        groupId,
        questionText: data.questionText,
        sortOrder: data.sortOrder ?? 0,
        meta: data.meta ?? {},
      })
      .returning();

    return question;
  }

  static async updateQuestion(groupId, userId, questionId, data) {
    await requireGroupAdmin(groupId, userId);

    const [question] = await db
      .update(groupQuestions)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(groupQuestions.id, questionId), eq(groupQuestions.groupId, groupId)))
      .returning();

    if (!question) throw new ApiError(404, 'Question not found');
    return question;
  }

  static async deleteQuestion(groupId, userId, questionId) {
    await requireGroupAdmin(groupId, userId);

    const [deleted] = await db
      .delete(groupQuestions)
      .where(and(eq(groupQuestions.id, questionId), eq(groupQuestions.groupId, groupId)))
      .returning();

    if (!deleted) throw new ApiError(404, 'Question not found');
    return deleted;
  }

  static async reorderQuestions(groupId, userId, questions) {
    await requireGroupAdmin(groupId, userId);

    await Promise.all(
      questions.map(({ id, sortOrder }) =>
        db
          .update(groupQuestions)
          .set({ sortOrder, updatedAt: new Date() })
          .where(and(eq(groupQuestions.id, id), eq(groupQuestions.groupId, groupId)))
      )
    );

    return this.getQuestions(groupId);
  }

  static async validateAndSnapshot(groupId, submittedAnswers = []) {
    const activeQuestions = await this.getQuestions(groupId);
    if (activeQuestions.length === 0) return [];

    const answerMap = new Map(submittedAnswers.map(a => [a.questionId, a]));

    const missing = activeQuestions
      .filter(q => !answerMap.has(q.id) || !answerMap.get(q.id).answer?.trim())
      .map(q => ({ id: q.id, questionText: q.questionText }));

    if (missing.length > 0) {
      throw new ApiError(400, 'Please answer all required questions', { missing });
    }

    return activeQuestions.map(q => {
      const submitted = answerMap.get(q.id);
      return {
        questionId: q.id,
        questionText: q.questionText,
        answer: submitted.answer.trim(),
        meta: submitted.meta ?? q.meta,
      };
    });
  }

  /**
   * Get join request answers visible to the group admin/moderator.
   *
   * For FREE groups: returns join requests (with embedded answers) filtered by
   *   optional `status` query param (pending | approved | rejected).
   * For PAID groups: the user joined automatically on checkout, so there are no
   *   meaningful pending requests — returns the list of active members instead.
   *
   * @param {string} groupId
   * @param {string} requestingUserId - must be admin or moderator
   * @param {{ status?: string, page?: number, limit?: number }} filters
   */
  static async getJoinRequestsWithAnswers(groupId, requestingUserId, filters = {}) {
    // Authorise: only admin / moderator may call this
    await requireGroupAdminOrModerator(groupId, requestingUserId);

    // Fetch the group to check isPaid
    const group = await db.query.groups.findFirst({
      where: eq(groups.id, groupId),
      columns: { id: true, isPaid: true },
    });
    if (!group) throw new ApiError(404, 'Group not found');

    const { status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    if (group.isPaid) {
      // Paid group — show active members with their submitted answers
      const members = await db
        .select({
          id: groupMembers.id,
          userId: groupMembers.userId,
          role: groupMembers.role,
          joinedAt: groupMembers.joinedAt,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          image: users.image,
          username: users.username,
          answers: groupJoinRequests.answers,
          requestMessage: groupJoinRequests.message,
        })
        .from(groupMembers)
        .innerJoin(users, eq(groupMembers.userId, users.id))
        .leftJoin(
          groupJoinRequests,
          and(
            eq(groupJoinRequests.groupId, groupMembers.groupId),
            eq(groupJoinRequests.userId, groupMembers.userId)
          )
        )
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'joined')))
        .orderBy(desc(groupMembers.joinedAt))
        .limit(limit)
        .offset(offset);

      // Enrich answers with question text
      const questions = await this.getQuestions(groupId);
      const questionMap = new Map(questions.map(q => [q.id, q.questionText]));

      const enrichedMembers = members.map(m => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        user: {
          id: m.userId,
          firstName: m.firstName,
          lastName: m.lastName,
          email: m.email,
          image: m.image,
          username: m.username,
        },
        message: m.requestMessage ?? null,
        answers: (m.answers || []).map(a => ({
          ...a,
          questionText: questionMap.get(a.questionId) ?? null,
        })),
      }));

      return { type: 'members', members: enrichedMembers };
    }

    // Free group with questions — show join requests with answers
    const conditions = [eq(groupJoinRequests.groupId, groupId)];
    if (status) {
      const allowed = ['pending', 'approved', 'rejected'];
      if (!allowed.includes(status)) {
        throw new ApiError(400, `Invalid status filter. Must be one of: ${allowed.join(', ')}`);
      }
      conditions.push(eq(groupJoinRequests.status, status));
    }

    const requests = await db
      .select({
        id: groupJoinRequests.id,
        userId: groupJoinRequests.userId,
        status: groupJoinRequests.status,
        message: groupJoinRequests.message,
        answers: groupJoinRequests.answers,
        isCompleted: groupJoinRequests.is_completed,
        createdAt: groupJoinRequests.createdAt,
        respondedAt: groupJoinRequests.respondedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        image: users.image,
        username: users.username,
      })
      .from(groupJoinRequests)
      .innerJoin(users, eq(groupJoinRequests.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(groupJoinRequests.createdAt))
      .limit(limit)
      .offset(offset);

    // Enrich answers with question text for readability
    const questions = await this.getQuestions(groupId);
    const questionMap = new Map(questions.map(q => [q.id, q.questionText]));

    const enriched = requests.map(r => ({
      ...r,
      user: {
        id: r.userId,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        image: r.image,
        username: r.username,
      },
      answers: (r.answers || []).map(a => ({
        ...a,
        questionText: questionMap.get(a.questionId) ?? null,
      })),
      // remove flat user fields
      firstName: undefined,
      lastName: undefined,
      email: undefined,
      image: undefined,
      username: undefined,
    }));

    return { type: 'join_requests', requests: enriched };
  }
}
