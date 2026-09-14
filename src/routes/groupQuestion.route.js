import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import {
  getGroupQuestions,
  createGroupQuestion,
  updateGroupQuestion,
  deleteGroupQuestion,
  reorderGroupQuestions,
  getGroupJoinRequestAnswers,
} from '../controllers/groupQuestion.controller.js';
import {
  createQuestionSchema,
  updateQuestionSchema,
  reorderQuestionsSchema,
  getJoinRequestAnswersSchema,
} from '../validations/groupQuestion.validation.js';

const router = express.Router();

// Public routes
router.get('/:groupId/questions', getGroupQuestions);

router.use(authMiddleware);

// Protected routes
router.get(
  '/:groupId/join-requests',
  validateMiddleware(getJoinRequestAnswersSchema),
  getGroupJoinRequestAnswers
);
router.post('/:groupId/questions', validateMiddleware(createQuestionSchema), createGroupQuestion);
router.put(
  '/:groupId/questions/reorder',
  validateMiddleware(reorderQuestionsSchema),
  reorderGroupQuestions
);
router.put(
  '/:groupId/questions/:questionId',
  validateMiddleware(updateQuestionSchema),
  updateGroupQuestion
);
router.delete('/:groupId/questions/:questionId', deleteGroupQuestion);

export default router;
