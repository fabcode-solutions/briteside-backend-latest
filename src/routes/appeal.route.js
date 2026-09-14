import { Router } from 'express';
import { authMiddlewareAllowSuspended } from '../middlewares/auth.middleware.js';
import {
  submitAppeal,
  getMyAppeals,
  getSuspensionStatus,
} from '../controllers/appeal.controller.js';

const router = Router();

router.use(authMiddlewareAllowSuspended);

router.get('/suspension-status', getSuspensionStatus);
router.post('/', submitAppeal);
router.get('/me', getMyAppeals);

export default router;
