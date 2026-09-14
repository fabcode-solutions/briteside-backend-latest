import { catchAsync } from '../utils/catch-async.js';
import { enqueueTrackBatch, linkAnonymousIdentity } from '../services/analyticsIngest.service.js';
import { runAnalyticsRollup } from '../cron/analyticsRollup.cron.js';

export const trackEvents = catchAsync(async (req, res) => {
  const { anonymousId, sessionId, events } = req.body;
  const userId = req.user?.id ?? null;

  const context = {
    platform: req.get('x-client-platform') ?? 'web',
    appVersion: req.get('x-app-version') ?? null,
  };

  await enqueueTrackBatch({ anonymousId, sessionId, events, userId, context });

  if (userId && anonymousId) {
    await linkAnonymousIdentity(anonymousId, userId);
  }

  res.status(202).json({ success: true, data: { accepted: events.length } });
});

// "Refresh live data" — runs the rollup cron on demand instead of waiting for
// its next scheduled tick, so a dashboard viewer can get fresh numbers now.
export const triggerRollup = catchAsync(async (req, res) => {
  await runAnalyticsRollup();
  res.json({ success: true, data: { triggeredAt: new Date().toISOString() } });
});
