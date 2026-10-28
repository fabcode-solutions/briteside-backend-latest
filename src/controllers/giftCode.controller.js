import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { GiftCodeService } from '../services/giftCode.service.js';

/**
 * POST /gift-codes/purchase/prepare
 * Auth required — step 1 of a gift purchase (BookOneOnOne "Yes, this is a
 * gift"). No date/time: price is the talent's flat rate for the duration.
 *
 * Body: { talentProfileId, durationMins, recipientName, recipientEmail,
 *         recipientPhone, occasion, personalMessage, deliveryDate }
 * Returns: { giftCodeId, talentPriceCents, platformAndServiceFeeCents, chargedCents }
 */
export const prepareGiftPurchase = catchAsync(async (req, res) => {
  const {
    talentProfileId,
    durationMins,
    recipientName,
    recipientEmail,
    recipientPhone,
    occasion,
    personalMessage,
    deliveryDate,
  } = req.body;

  if (!talentProfileId) throw new ApiError(400, '`talentProfileId` is required');
  if (!durationMins) throw new ApiError(400, '`durationMins` is required');
  if (!recipientEmail) throw new ApiError(400, '`recipientEmail` is required');

  const result = await GiftCodeService.preparePurchase({
    gifterId: req.user.id,
    talentProfileId,
    durationMins: parseInt(durationMins),
    recipientName,
    recipientEmail,
    recipientPhone,
    occasion,
    personalMessage,
    deliveryDate,
  });

  res.status(201).json({ success: true, data: result });
});

/**
 * POST /gift-codes/:giftCodeId/native-intent
 * Auth required — step 2, creates the Stripe PaymentIntent.
 */
export const createGiftNativeIntent = catchAsync(async (req, res) => {
  const { giftCodeId } = req.params;
  const result = await GiftCodeService.createNativePaymentIntent(giftCodeId, req.user.id);
  res.json({ success: true, data: result });
});

/**
 * POST /gift-codes/:giftCodeId/native-finalize
 * Auth required — step 3, verifies payment and delivers (or schedules) the
 * gift email.
 *
 * Body: { paymentIntentId }
 */
export const finalizeGiftNativePayment = catchAsync(async (req, res) => {
  const { giftCodeId } = req.params;
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) throw new ApiError(400, '`paymentIntentId` is required');

  const result = await GiftCodeService.finalizeNativePayment(
    giftCodeId,
    req.user.id,
    paymentIntentId
  );
  res.json({ success: true, data: result });
});

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
