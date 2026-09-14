import { Router } from 'express';
import { createLimiter } from '../middlewares/rateLimiter.js';
import { validateMiddleware } from '../middlewares/validate.middleware.js';
import { searchQuerySchema } from '../validations/search.validation.js';
import { universalSearch } from '../controllers/search.controller.js';
import { optionalAuthMiddleware } from '../middlewares/auth.middleware.js';

const router = Router();

// 60 req/min per IP — tighter than the default because this endpoint
// fans out to 3 parallel DB queries on each request.
const searchLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV !== 'production' ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 429, message: 'Too many search requests. Try again shortly.' },
  },
});

// Stays public (no auth required) — optionalAuthMiddleware only attaches
// req.user WHEN a valid token is present, so an anonymous visitor still
// searches fine; a logged-in user gets blocked-user filtering, which never
// ran before since nothing here ever populated req.user at all.
router.get('/', optionalAuthMiddleware, searchLimiter, universalSearch);

export default router;
