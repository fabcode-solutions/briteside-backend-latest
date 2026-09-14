import 'dotenv/config';
import { loadSecrets } from '../src/config/secrets.js';

// One-time (idempotent) setup: enable frame recording as an on-demand
// capability for the "default" call type (used by talent sessions).
// mode: 'available' means it does NOT auto-start for every call of this
// type — it only runs when TalentSessionService explicitly calls
// startFrameRecording(), at booking confirmation. Safe to re-run.
// Run: node scripts/setup-frame-recording.js

process.env.USE_AWS_SECRETS = process.env.USE_AWS_SECRETS || 'true';
await loadSecrets();
const { streamClient } = await import('../src/utils/streamClient.js');

await streamClient.video.updateCallType({
  name: 'default',
  settings: {
    frame_recording: {
      mode: 'available',
      capture_interval_in_seconds: 5,
      quality: '480p',
    },
  },
});

console.log('Call type "default" frame_recording set to mode=available, 5s interval, 480p.');
