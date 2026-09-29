import { catchAsync } from '../utils/catch-async.js';
import { IapNotificationService } from '../services/iapNotification.service.js';

// Both routes are mounted under /api/webhooks with a raw body parser.
const parseJsonBody = body =>
  Buffer.isBuffer(body) ? JSON.parse(body.toString('utf8') || '{}') : (body ?? {});

// POST /api/webhooks/apple-iap — App Store Server Notifications V2
export const appleIapWebhook = catchAsync(async (req, res) => {
  const result = await IapNotificationService.handleApple(parseJsonBody(req.body));
  res.json({ success: true, data: result });
});

// POST /api/webhooks/google-play — Google Play RTDN via Cloud Pub/Sub push
export const googlePlayWebhook = catchAsync(async (req, res) => {
  const result = await IapNotificationService.handleGoogle(
    parseJsonBody(req.body),
    req.headers.authorization
  );
  res.json({ success: true, data: result });
});
