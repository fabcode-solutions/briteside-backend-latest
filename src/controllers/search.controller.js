import { catchAsync } from '../utils/catch-async.js';
import { SearchService } from '../services/search.service.js';

export const universalSearch = catchAsync(async (req, res) => {
  const { q, limit } = req.query;
  const viewerId = req.user?.id;
  const result = await SearchService.universalSearch({ q, limit, viewerId });
  res.json({ success: true, data: result });
});
