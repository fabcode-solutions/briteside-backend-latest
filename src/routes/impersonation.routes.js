import express from 'express';
import httpStatus from 'http-status';

import { authMiddleware } from '../middlewares/auth.middleware.js';
import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { adminService } from '../services/admin.service.js';

const router = express.Router();

// Only authMiddleware — deliberately NOT requireAdmin. While impersonating,
// req.user is the target user (who may not be an admin), so this route
// authorizes itself off req.impersonatedBy instead.
router.post(
  '/end',
  authMiddleware,
  catchAsync(async (req, res) => {
    if (!req.impersonatedBy) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'No active impersonation session');
    }

    const result = await adminService.endImpersonation(req.user.id, req.impersonatedBy);

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Impersonation ended',
      data: result,
    });
  })
);

export default router;