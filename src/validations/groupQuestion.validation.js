import { z } from 'zod';

export const createQuestionSchema = z.object({
  body: z
    .object({
      questionText: z.string().min(1).max(500),
      sortOrder: z.number().int().optional().default(0),
      isActive: z.boolean().optional().default(true),
      meta: z.record(z.string(), z.unknown()).optional().default({}),
    })
    .optional(),
  params: z.object({
    // Ensure this name matches exactly what you saw in your console log
    groupId: z.string().uuid('Invalid UUID format'),
  }),
  query: z.object({}).optional(),
});

export const updateQuestionSchema = z.object({
  body: z.object({
    questionText: z.string().min(1).max(500).optional(),
    sortOrder: z.number().int().min(0).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  }),
  params: z.object({
    questionId: z.string().uuid('Invalid question ID'),
  }),
  query: z.object({}),
});

export const reorderQuestionsSchema = z.object({
  body: z.object({
    questions: z
      .array(
        z.object({
          id: z.string().uuid('Invalid question ID'),
          sortOrder: z.number().int().min(0),
        })
      )
      .min(1, 'At least one question required'),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const joinAnswerItemSchema = z.object({
  questionId: z.string().uuid('Invalid question ID'),
  // Deliberately no .min(1) here — an empty/blank answer is a "missing
  // answer", and groupQuestion.service.js's own missing-answers check
  // already produces a friendly, per-field {missing: [...]} error for that.
  // Rejecting it here instead would short-circuit the request before it
  // ever reaches that check, surfacing a raw Zod error to the user instead.
  answer: z.string(),
  meta: z.record(z.string(), z.unknown()).optional().default({}),
});

export const joinWithAnswersSchema = z.object({
  body: z.object({
    answers: z.array(joinAnswerItemSchema).optional().default([]),
  }),
  params: z.object({
    groupId: z.string().uuid('Invalid group ID'),
  }),
  query: z.object({}),
});

export const getJoinRequestAnswersSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    groupId: z.string().uuid('Invalid group ID'),
  }),
  query: z.object({
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    page: z.string().regex(/^\d+$/, 'page must be a positive integer').optional(),
    limit: z.string().regex(/^\d+$/, 'limit must be a positive integer').optional(),
  }),
});
