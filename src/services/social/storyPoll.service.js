import { db } from '../../db/index.js';
import { stories, storyPolls, storyPollResponses } from '../../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import ApiError from '../../utils/api-error.js';
import { TextModerationService, TEXT_ENTITY } from '../moderation/textModeration.service.js';

/**
 * Compute analytics from a poll's responses array.
 * Returned in creator view and embedded in story fetch.
 */
export function computePollAnalytics(type, meta, responses) {
  const total = responses.length;

  if (type === 'poll') {
    const options = (meta?.options ?? []).map((label, idx) => {
      const count = responses.filter(r => r.response?.optionIndex === idx).length;
      return { label, count, percentage: total ? Math.round((count / total) * 100) : 0 };
    });
    return { total, options };
  }

  if (type === 'quiz') {
    const correctOption = meta?.correctOption ?? null;
    const correctCount = responses.filter(r => r.isCorrect === true).length;
    const options = (meta?.options ?? []).map((label, idx) => {
      const count = responses.filter(r => r.response?.optionIndex === idx).length;
      return {
        label,
        count,
        percentage: total ? Math.round((count / total) * 100) : 0,
        isCorrect: idx === correctOption,
      };
    });
    return { total, correctCount, options };
  }

  if (type === 'slider') {
    if (total === 0) return { total, average: null, min: null, max: null };
    const values = responses.map(r => r.response?.value ?? 0);
    const average = Math.round(values.reduce((s, v) => s + v, 0) / total);
    return { total, average, min: Math.min(...values), max: Math.max(...values) };
  }

  if (type === 'question') {
    const answers = responses.map(r => ({
      userId: r.userId,
      text: r.response?.text ?? '',
      createdAt: r.createdAt,
    }));
    return { total, answers };
  }

  return { total };
}

export class StoryPollService {
  /**
   * Create or replace the poll attached to a story.
   * Only the story creator may do this.
   */
  static async createPoll(storyId, userId, { type, question, meta }) {
    const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
    if (!story) throw new ApiError(404, 'Story not found');
    if (story.userId !== userId) throw new ApiError(403, 'Only the story creator can add a poll');

    const VALID_TYPES = ['poll', 'quiz', 'slider', 'question'];
    if (!VALID_TYPES.includes(type)) {
      throw new ApiError(400, `type must be one of: ${VALID_TYPES.join(', ')}`);
    }
    if (!question?.trim()) throw new ApiError(400, 'question is required');

    const questionModeration = await TextModerationService.assertAllowed({
      entityType: TEXT_ENTITY.STORY,
      entityCreatorId: userId,
      texts: [question],
    });

    const [poll] = await db
      .insert(storyPolls)
      .values({ storyId, userId, type, question: question.trim(), meta: meta ?? null })
      .returning();

    await TextModerationService.recordIfFlagged(questionModeration, {
      entityType: TEXT_ENTITY.STORY,
      entityId: poll.id,
      userId,
      fieldNames: ['question'],
      texts: [question.trim()],
    });

    return poll;
  }

  /**
   * Submit a response to a specific story poll.
   * Viewers only — the creator cannot respond to their own poll.
   * One response per user per poll is enforced at the DB level (unique constraint).
   */
  static async respond(pollId, userId, { response }) {
    const poll = await db.query.storyPolls.findFirst({
      where: eq(storyPolls.id, pollId),
    });
    if (!poll) throw new ApiError(404, 'Poll not found');
    if (poll.userId === userId) {
      throw new ApiError(403, 'Story creator cannot respond to their own poll');
    }

    if (!response || typeof response !== 'object') {
      throw new ApiError(400, 'response is required');
    }

    // Validate response shape per type
    if (
      (poll.type === 'poll' || poll.type === 'quiz') &&
      typeof response.optionIndex !== 'number'
    ) {
      throw new ApiError(400, 'response.optionIndex (number) is required for poll/quiz');
    }
    if (poll.type === 'slider' && typeof response.value !== 'number') {
      throw new ApiError(400, 'response.value (number) is required for slider');
    }
    if (poll.type === 'question' && typeof response.text !== 'string') {
      throw new ApiError(400, 'response.text (string) is required for question');
    }

    // Compute isCorrect for quiz
    let isCorrect = null;
    if (poll.type === 'quiz') {
      isCorrect = response.optionIndex === poll.meta?.correctOption;
    }

    // Insert — unique constraint will reject duplicates
    const result = await db
      .insert(storyPollResponses)
      .values({ pollId: poll.id, userId, response, isCorrect })
      .onConflictDoNothing()
      .returning();

    if (result.length === 0) {
      throw new ApiError(409, 'You have already responded to this poll');
    }

    return result[0];
  }

  /**
   * Delete a specific poll (cascade removes all its responses).
   * Only the story creator may do this.
   */
  static async deletePoll(pollId, userId) {
    const poll = await db.query.storyPolls.findFirst({
      where: eq(storyPolls.id, pollId),
    });
    if (!poll) throw new ApiError(404, 'Poll not found');
    if (poll.userId !== userId) {
      throw new ApiError(403, 'Only the story creator can delete this poll');
    }

    await db.delete(storyPolls).where(eq(storyPolls.id, pollId));
  }
}
