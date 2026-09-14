import { db } from '../db/index.js';
import { imports } from '../db/schema/imports.js';
import { eq, and } from 'drizzle-orm';
import ApiError from '../utils/api-error.js';
import httpStatus from 'http-status';
import { catchAsync } from '../utils/catch-async.js';

export const importOwner = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;

  const [imp] = await db
    .select({ id: imports.id, userId: imports.userId, status: imports.status })
    .from(imports)
    .where(and(eq(imports.id, id), eq(imports.userId, userId)))
    .limit(1);

  if (!imp) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Import not found');
  }

  req.import = imp;
  next();
});
