import { CategoryService } from '../services/category.service.js';
import { catchAsync } from '../utils/catch-async.js';

export const getCategories = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const result = await CategoryService.getCategories({ page, limit });

  res.json({
    success: true,
    data: result,
  });
});

export const seedCategories = catchAsync(async (req, res) => {
  const result = await CategoryService.seedCategories();

  res.json({
    success: true,
    message: 'Categories seeded successfully',
    data: result,
  });
});
