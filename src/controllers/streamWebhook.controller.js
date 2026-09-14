import { catchAsync } from '../utils/catch-async.js';
import { streamClient } from '../services/stream.service.js';
import { DemoSessionService } from '../services/demo.service.js';
import { LivestreamService } from '../services/livestream.service.js';
import { MediaModerationService } from '../services/moderation/mediaModeration.service.js';
import {
  TalentSessionService,
  TALENT_SESSION_FRAME_ENTITY,
} from '../services/talentSession.service.js';
import { emitLivestreamUpdate } from '../socket/emitter.js';

export const streamWebhookHandler = catchAsync(async (req, res) => {
  // Stream sends the HMAC of the raw body in the `x-signature` header (+ `x-api-key`).
  const signature = req.headers['x-signature'];

  if (!signature) {
    return res.status(400).json({ error: 'Missing webhook signature header' });
  }

  const rawBody = req.body.toString('utf8');
  const isValid = streamClient.verifyWebhook(rawBody, signature);
  if (!isValid) {
    console.error('Stream webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  res.status(200).json({ received: true });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.error('Stream webhook: failed to parse body');
    return;
  }

  const io = req.app.get('io');

  // ── Content moderation verdicts (these events carry no call id) ───────────
  if (event.type === 'moderation_check.completed') {
    try {
      if (event.entity_type === TALENT_SESSION_FRAME_ENTITY) {
        await TalentSessionService.applyFrameVerdict({
          entityId: event.entity_id,
          action: event.recommended_action,
          reviewQueueItemId: event.review_queue_item_id,
          io,
        });
      } else {
        await MediaModerationService.applyVerdict({
          entityType: event.entity_type,
          entityId: event.entity_id,
          action: event.recommended_action,
          reviewId: event.review_queue_item_id,
        });
      }
    } catch (err) {
      console.error('Stream webhook: failed to apply moderation verdict:', err.message);
    }
    return;
  }

  if (event.type === 'review_queue_item.new' || event.type === 'review_queue_item.updated') {
    // Keeps our DB in sync when moderators act in the Stream dashboard
    // (restore/delete change recommended_action on the item).
    try {
      const item = event.review_queue_item ?? event.item;
      if (item?.entity_type && item?.entity_id && item?.recommended_action) {
        if (item.entity_type === TALENT_SESSION_FRAME_ENTITY) {
          await TalentSessionService.applyFrameVerdict({
            entityId: item.entity_id,
            action: item.recommended_action,
          });
        } else {
          await MediaModerationService.applyVerdict({
            entityType: item.entity_type,
            entityId: item.entity_id,
            action: item.recommended_action,
            reviewId: item.id,
            labels: (item.flags || []).flatMap(f => f.labels || []),
          });
        }
      }
    } catch (err) {
      console.error('Stream webhook: failed to sync review queue item:', err.message);
    }
    return;
  }

  const callId = event.call_cid?.split(':')?.[1] ?? event.call?.id;

  // console.log(`Stream webhook received [${event.type}]:`, JSON.stringify(event, null, 2));

  if (!callId) return;

  // ── Demo sessions ──────────────────────────────────────────────────────────
  if (callId.startsWith('demo-')) {
    try {
      if (event.type === 'call.session_started') {
        await DemoSessionService.updateStatusByCallId(callId, 'active');
      } else if (event.type === 'call.session_ended' || event.type === 'call.ended') {
        await DemoSessionService.updateStatusByCallId(callId, 'completed');
      }
    } catch (err) {
      console.error('Stream webhook: failed to update demo session status:', err.message);
    }
    return;
  }

  // ── Talent session call moderation ────────────────────────────────────────
  // Note: the real event type Stream sends is "call.frame_recording_ready"
  // (confirmed against the installed @stream-io/node-sdk types) — the docs
  // prose says "frame_recording_frame_ready" but the docs' own JSON example
  // and the SDK types agree on "call.frame_recording_ready".
  if (event.type === 'call.frame_recording_ready') {
    try {
      const session = await TalentSessionService.getByCallId(callId);
      if (session) {
        const participantIds = Object.keys(event.users || {});
        for (const participantId of participantIds) {
          await TalentSessionService.submitFrameForModeration({
            session,
            trackType: event.track_type,
            participantId,
            frameUrl: event.url,
            io,
          });
        }
      }
    } catch (err) {
      console.error('Stream webhook: failed to process frame recording event:', err.message);
    }
    return;
  }

  // ── Livestreams ──────────────────────────────────────────────────────────
  // Fixes "status stuck on live": update the DB from GetStream call events so a
  // stream is marked ended when the host leaves / closes the tab / drops off,
  // even if they never hit the End button.
  try {
    const stream = await LivestreamService.getByCallId(callId);
    if (!stream) return;

    // Terminal call events — the stream is over. GetStream fires these whenever a
    // call ends, for ANY reason (host closed tab, crashed, dropped, or ended it),
    // so the webhook is the one path guaranteed to run. The manual /end endpoint
    // (called by the frontend on tab-close via keepalive POST) may set the DB to
    // ended but fail to emit if its request is aborted mid-flight — so we always
    // emit here, even when the row is already 'ended', to guarantee the sidebar
    // gets the update. The emit is idempotent for clients.
    const hostLeft =
      event.type === 'call.session_participant_left' &&
      event.participant?.user?.id === stream.userId;
    const sessionEnded = event.type === 'call.session_ended' || event.type === 'call.ended';

    if (!hostLeft && !sessionEnded) return;

    // DB write only if not already ended (services are idempotent, but skip the
    // GetStream call.end() round-trip when nothing needs to change).
    if (stream.status !== 'ended') {
      if (hostLeft) {
        await LivestreamService.forceEndByCallId(callId);
      } else {
        await LivestreamService.markEndedByCallId(callId);
      }
    }

    const io = req.app.get('io');
    if (io) emitLivestreamUpdate(io, 'livestream:ended', { streamId: stream.id });
  } catch (err) {
    console.error('Stream webhook: failed to update livestream status:', err.message);
  }
});

export default streamWebhookHandler;
