import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { getCategories, seedCategories } from '../controllers/category.controller.js';

const router = express.Router();

// Public routes
router.get('/', getCategories);

// Protected routes (admin only for seeding)
router.post('/seed', authMiddleware, seedCategories);

export default router;
