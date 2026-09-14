import { GroupQuestionService } from '../services/groupQuestion.service.js';
import { catchAsync } from '../utils/catch-async.js';

export const getGroupJoinRequestAnswers = catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const { status, page, limit } = req.query;
  const result = await GroupQuestionService.getJoinRequestsWithAnswers(groupId, req.user.id, {
    status,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
  });
  res.json({ success: true, data: result });
});

export const getGroupQuestions = catchAsync(async (req, res) => {
  const questions = await GroupQuestionService.getQuestions(req.params.groupId);
  res.json({ success: true, data: { questions } });
});

export const createGroupQuestion = catchAsync(async (req, res) => {
  const question = await GroupQuestionService.createQuestion(
    req.params.groupId,
    req.user.id,
    req.body
  );
  res.status(201).json({ success: true, message: 'Question created', data: { question } });
});

export const updateGroupQuestion = catchAsync(async (req, res) => {
  const question = await GroupQuestionService.updateQuestion(
    req.params.groupId,
    req.user.id,
    req.params.questionId,
    req.body
  );
  res.json({ success: true, message: 'Question updated', data: { question } });
});

export const deleteGroupQuestion = catchAsync(async (req, res) => {
  await GroupQuestionService.deleteQuestion(req.params.groupId, req.user.id, req.params.questionId);
  res.json({ success: true, message: 'Question deleted' });
});

export const reorderGroupQuestions = catchAsync(async (req, res) => {
  const questions = await GroupQuestionService.reorderQuestions(
    req.params.groupId,
    req.user.id,
    req.body.questions
  );
  res.json({ success: true, message: 'Questions reordered', data: { questions } });
});
