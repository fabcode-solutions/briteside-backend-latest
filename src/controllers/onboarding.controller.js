import { catchAsync } from '../utils/catch-async.js';
import { OnboardingService } from '../services/onboarding.service.js';

// GET /api/onboarding — categories, current picks, completion flag
export const getOnboarding = catchAsync(async (req, res) => {
  const data = await OnboardingService.getOnboardingState(req.user.id);
  res.json({ success: true, data });
});

// PUT /api/onboarding — { eventCategoryIds: string[], groupCategoryIds: string[] }
export const saveOnboarding = catchAsync(async (req, res) => {
  const data = await OnboardingService.saveOnboarding(req.user.id, {
    eventCategoryIds: req.body?.eventCategoryIds,
    groupCategoryIds: req.body?.groupCategoryIds,
  });
  res.json({ success: true, data });
});
