import express from 'express';
import { reportController } from '../controllers/report.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();
router.use(authMiddleware);
// Create report
router.post('/', reportController.createReport);

// Get all reports
router.get('/', reportController.getReports);

// Update report status
router.patch('/:reportId/status', reportController.updateReportStatus);

export default router;
