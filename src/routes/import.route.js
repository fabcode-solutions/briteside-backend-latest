import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { importOwner } from '../middlewares/importOwner.middleware.js';
import { importPresignLimiter } from '../middlewares/rateLimiter.js';
import {
  getImportStatus,
  createImport,
  presignImages,
  submitImport,
  getImport,
  getImportImages,
  deleteImport,
} from '../controllers/import.controller.js';

const router = express.Router();

router.use(authMiddleware);

// Check if user can still use onboarding import (frontend uses canImport to show/hide button)
router.get('/status', getImportStatus);

// Create draft import session
router.post('/', createImport);

// Generate S3 upload URLs (rate limited: 3 per hour per user)
router.post('/:id/presign', importOwner, importPresignLimiter, presignImages);

// Submit for background processing
router.post('/:id/submit', importOwner, submitImport);

// Get import status + progress
router.get('/:id', importOwner, getImport);

// List all images with per-image status
router.get('/:id/images', importOwner, getImportImages);

// Delete draft only
router.delete('/:id', importOwner, deleteImport);

export default router;
