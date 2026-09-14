import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { GiftCodeService } from '../services/giftCode.service.js';

/**
 * POST /gift-codes/validate
 * Public — called from the "Apply" button in BookOneOnOne before booking.
 *
 * Body: { code, talentProfileId, durationMins }
 * Returns: { valid, reason?, priceCents?, durationMins?, giftId?, correctDuration? }
 */
export const validateGiftCode = catchAsync(async (req, res) => {
  const { code, talentProfileId } = req.body;

  if (!code) throw new ApiError(400, '`code` is required');
  if (!talentProfileId) throw new ApiError(400, '`talentProfileId` is required');

  const result = await GiftCodeService.validate(code, talentProfileId);

  res.json({ success: true, data: result });
});

/**
 * GET /gift-codes/my-gifts
 * Auth required — gifter views all codes they have generated.
 */
export const getMyGiftCodes = catchAsync(async (req, res) => {
  const { page, limit } = req.query;

  const gifts = await GiftCodeService.listByGifter(req.user.id, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 10,
  });

  res.json({ success: true, data: { gifts } });
});
