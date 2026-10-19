import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireAdmin } from '../middlewares/auth.middleware.js';
import { adminController } from '../controllers/admin.controller.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const router = Router();

const validateQuery = schema => (req, res, next) => {
  try {
    res.locals.validatedQuery = schema.parse(req.query);
    next();
  } catch (err) {
    res.status(400).json({ success: false, error: { message: err.message } });
  }
};

const dateRangeQuery = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

router.use(authMiddleware, requireAdmin);

router.get('/overview', validateQuery(dateRangeQuery), adminController.getOverviewStats);
router.get(
  '/events-overview',
  validateQuery(dateRangeQuery),
  adminController.getAdminEventsOverview
);
router.get('/user-metrics', validateQuery(dateRangeQuery), adminController.getUserMetrics);
router.get('/mau-trend', validateQuery(dateRangeQuery), adminController.getMauTrend);
router.get('/signups-trend', validateQuery(dateRangeQuery), adminController.getSignupsTrend);
router.get('/demographics', validateQuery(dateRangeQuery), adminController.getDemographicsStats);
router.get('/interests', validateQuery(dateRangeQuery), adminController.getInterestsAnalytics);
router.get(
  '/group-courses',
  validateQuery(dateRangeQuery),
  adminController.getGroupCourseAnalyticsAdmin
);
export default router;
