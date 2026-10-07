/**
 * src/controllers/quickPay.controller.js
 * Generic "pay a saved card directly" endpoints — currently only wired up
 * for priority messages (sourceType 'priority_message').
 */

import { catchAsync } from '../utils/catch-async.js';
import ApiError from '../utils/api-error.js';
import { QuickPayService } from '../services/quickPay.service.js';

/**
 * GET /payments/saved-card
 * Returns: { card: { id, brand, last4, expMonth, expYear } | null }
 */
export const getSavedCard = catchAsync(async (req, res) => {
  const card = await QuickPayService.getSavedCard(req.user.id);
  res.json({ success: true, data: { card } });
});

/**
 * POST /payments/quick-pay
 * Body: { paymentMethodId, amountCents, sourceType, sourceId, idempotencyKey? }
 */
export const quickPay = catchAsync(async (req, res) => {
  const { paymentMethodId, amountCents, sourceType, sourceId, idempotencyKey } = req.body;

  if (!paymentMethodId) throw new ApiError(400, '`paymentMethodId` is required');
  if (!sourceType) throw new ApiError(400, '`sourceType` is required');
  if (!sourceId) throw new ApiError(400, '`sourceId` is required');

  const result = await QuickPayService.quickPay(
    req.user.id,
    { paymentMethodId, amountCents, sourceType, sourceId, idempotencyKey },
    req.app.get('io')
  );

  res.status(result.success ? 201 : 200).json({ success: true, data: result });
});
