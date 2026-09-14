import { ReviewService } from '../services/review.service.js';
import { catchAsync } from '../utils/catch-async.js';

export const getPendingPrompts = catchAsync(async (req, res) => {
  const prompts = await ReviewService.getPendingPrompts(req.user.id);

  res.json({
    success: true,
    data: { prompts },
  });
});

export const submitEventReview = catchAsync(async (req, res) => {
  const review = await ReviewService.submitEventReview(req.user.id, req.body);

  res.status(201).json({
    success: true,
    message: 'Review submitted successfully',
    data: { review },
  });
});

export const getEventReviews = catchAsync(async (req, res) => {
  const options = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
    sortBy: req.query.sortBy || 'helpful',
    minRating: req.query.minRating ? parseInt(req.query.minRating) : undefined,
    verifiedOnly: req.query.verifiedOnly === 'true',
  };

  const result = await ReviewService.getEventReviews(req.params.eventId, options);

  res.json({
    success: true,
    data: result,
  });
});

export const markReviewHelpful = catchAsync(async (req, res) => {
  const result = await ReviewService.markReviewHelpful(
    req.user.id,
    req.params.reviewId,
    req.body.isHelpful
  );

  res.json({
    success: true,
    message: 'Review helpfulness updated',
    data: result,
  });
});

export const dismissPrompt = catchAsync(async (req, res) => {
  const result = await ReviewService.dismissPrompt(req.user.id, req.params.eventId);

  res.json({
    success: true,
    message: 'Review prompt dismissed',
    data: result,
  });
});

export const createReviewPrompts = catchAsync(async (req, res) => {
  const result = await ReviewService.createReviewPrompts(req.params.eventId);

  res.json({
    success: true,
    message: 'Review prompts processed',
    data: result,
  });
});
