import 'dotenv/config';
import { loadSecrets } from '../src/config/secrets.js';

// One-time (idempotent) setup for Stream text moderation.
// Creates blocklists + upserts the two text policies used by
// src/services/moderation/textModeration.service.js.
// Run: node scripts/setup-moderation-config.js
//
// After running, verify labels/actions in Stream Dashboard → Moderation → Policies.
// Label keys must match Bodyguard's taxonomy — adjust in the dashboard if any
// rule below is rejected or ignored.

// STREAM_API_KEY/SECRET live in AWS Secrets Manager — load before the client is constructed
process.env.USE_AWS_SECRETS = process.env.USE_AWS_SECRETS || 'true';
await loadSecrets();
const { streamClient } = await import('../src/utils/streamClient.js');

const SYNC_KEY = 'gokiro_text';
const ASYNC_KEY = 'gokiro_text_async';
const MEDIA_KEY = 'gokiro_media';

// Regex blocklist entries must be ≤60 chars each, max 100 per list.
const PII_REGEX_LIST = {
  name: 'gokiro_pii_regex',
  type: 'regex',
  words: [
    // phone numbers (10+ digits, optional separators)
    '(\\+?\\d{1,3}[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}',
    // emails
    '[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}',
  ],
};

// Word-level masking uses Stream's reserved default 'profanity' blocklist
// (1105 words, managed by Stream — cannot be created/edited/deleted, just
// referenced by name) with action:'mask', so Labels API calls return
// masked_content. The old custom gokiro_profanity list (9 words, action:
// 'remove') was removed from the dashboard — LLM rules below still handle
// removal of severe content; this list's job is masking only.

// Severity-based rules for the sync (block-before-send) policy.
const AI_TEXT_RULES_SYNC = [
  { label: 'PEDOPHILIA', action: 'remove' },
  { label: 'TERRORISM', action: 'remove' },
  {
    label: 'THREAT',
    severity_rules: [
      { severity: 'low', action: 'flag' },
      { severity: 'medium', action: 'flag' },
      { severity: 'high', action: 'remove' },
      { severity: 'critical', action: 'remove' },
    ],
  },
  {
    label: 'SELF_HARM',
    severity_rules: [
      { severity: 'low', action: 'flag' },
      { severity: 'medium', action: 'flag' },
      { severity: 'high', action: 'remove' },
      { severity: 'critical', action: 'remove' },
    ],
  },
  {
    label: 'HATRED',
    severity_rules: [
      { severity: 'low', action: 'flag' },
      { severity: 'medium', action: 'flag' },
      { severity: 'high', action: 'remove' },
      { severity: 'critical', action: 'remove' },
    ],
  },
  {
    label: 'SEXUAL_HARASSMENT',
    severity_rules: [
      { severity: 'low', action: 'flag' },
      { severity: 'medium', action: 'remove' },
      { severity: 'high', action: 'remove' },
      { severity: 'critical', action: 'remove' },
    ],
  },
  {
    label: 'INSULT',
    severity_rules: [
      { severity: 'low', action: 'flag' },
      { severity: 'medium', action: 'flag' },
      { severity: 'high', action: 'remove' },
      { severity: 'critical', action: 'remove' },
    ],
  },
  {
    label: 'VULGARITY',
    severity_rules: [
      { severity: 'low', action: 'flag' },
      { severity: 'high', action: 'remove' },
    ],
  },
  {
    label: 'SEXUALLY_EXPLICIT',
    severity_rules: [
      { severity: 'low', action: 'flag' },
      { severity: 'high', action: 'remove' },
    ],
  },
  { label: 'SCAM', action: 'flag' },
  { label: 'PLATFORM_BYPASS', action: 'flag' },
  { label: 'PII', action: 'flag' },
  { label: 'DOXXING', action: 'remove' },
];

// Async policy flags only — reports/support text must never be blocked.
const AI_TEXT_RULES_ASYNC = AI_TEXT_RULES_SYNC.map(rule => ({ label: rule.label, action: 'flag' }));

// ── LLM text engine ──────────────────────────────────────────────────────────
// This app's AI enablement provisions the LLM engine (not Bodyguard NLP) —
// rules are plain-language detection prompts. Keep prompts single-purpose.
const APP_CONTEXT =
  'Social events platform with event listings, a social feed (posts, stories, comments), ' +
  'direct messages, group discussions, livestream chat, and paid talent sessions. ' +
  'Users write in English, Hindi, and romanized Hinglish. Casual social tone; ' +
  'mentions of parties, nightlife, and alcohol at events are normal and acceptable.';

const LLM_RULES_SYNC = [
  {
    label: 'THREAT',
    description:
      'Detect direct or implied threats of physical harm, violence, or intimidation toward a person, in any language including Hindi and romanized Hinglish.',
    action: 'remove',
  },
  {
    label: 'HATE_SPEECH',
    description:
      'Detect content promoting hatred, discrimination, or violence against people based on religion, caste, race, gender, or sexuality, in any language.',
    action: 'flag',
  },
  {
    label: 'SEXUAL_HARASSMENT',
    description:
      'Detect unwanted sexual advances, sexually explicit remarks directed at a person, or attempts to sexually humiliate someone.',
    action: 'remove',
  },
  {
    label: 'SELF_HARM',
    description:
      'Detect content encouraging self-harm or suicide, including telling someone to kill themselves or that they should not exist, in any language.',
    action: 'remove',
  },
  {
    label: 'SEVERE_INSULT',
    description:
      'Detect strong personal abuse, slurs, or degrading insults directed at a person, including Hindi profanity and romanized Hinglish slang such as gandu, chutiya, madarchod, bhosdike.',
    action: 'flag',
  },
  {
    label: 'VULGARITY',
    description:
      'Detect crude or profane language that is not a direct attack on a person, in any language.',
    action: 'flag',
  },
  {
    label: 'SCAM',
    description:
      'Detect fraud, phishing, fake prize claims, requests for OTP codes or bank details, or other deceptive practices.',
    action: 'flag',
  },
  {
    label: 'PII',
    description:
      'Detect sharing of phone numbers, home addresses, email addresses, or other personal contact information.',
    action: 'flag',
  },
  {
    label: 'PLATFORM_BYPASS',
    description:
      'Detect attempts to move the conversation to WhatsApp, Telegram, or another external platform, or requests for contact details to communicate off-platform.',
    action: 'flag',
  },
];

const LLM_RULES_ASYNC = LLM_RULES_SYNC.map(rule => ({ ...rule, action: 'flag' }));

// AWS Rekognition rules — images and videos are tuned separately in the
// dashboard (different confidence scales, image rules carry subclassification
// overrides that videos don't support). Alcohol / Swimwear / Gambling
// intentionally omitted — event platform, too many legitimate matches.
// Adjust in Dashboard → Policies → gokiro_media.
const AI_IMAGE_RULES = [
  {
    label: 'Explicit',
    action: 'remove',
    min_confidence: 90,
    subclassifications: {
      'Exposed Buttocks or Anus': true,
      'Exposed Female Genitalia': 80,
      'Exposed Female Nipple': 90,
      'Exposed Male Genitalia': true,
      'Sex Toys': true,
      'Explicit Sexual Activity': true,
    },
  },
  {
    label: 'Non-Explicit Nudity of Intimate parts and Kissing',
    action: 'flag',
    min_confidence: 50,
    subclassifications: {
      'Implied Nudity': false,
      'Kissing on the Lips': true,
      'Obstructed Female Nipple': true,
      'Obstructed Male Genitalia': true,
      'Partially Exposed Buttocks': false,
      'Partially Exposed Female Breast': false,
      'Bare Back': false,
      'Exposed Male Nipple': false,
    },
  },
  {
    label: 'Violence',
    action: 'flag',
    min_confidence: 85,
    subclassifications: {
      'Blood & Gore': true,
      'Explosions and Blasts': false,
      'Physical Violence': true,
      'Self-Harm': true,
      'Weapon Violence': true,
      Weapons: false,
    },
  },
  {
    label: 'Visually Disturbing',
    action: 'flag',
    min_confidence: 85,
    subclassifications: { 'Emaciated Bodies': true, 'Air Crash': true, Corpses: true },
  },
  {
    label: 'Drugs & Tobacco',
    action: 'flag',
    min_confidence: 85,
    subclassifications: { Smoking: true, Pills: true },
  },
  {
    label: 'Rude Gestures',
    action: 'flag',
    min_confidence: 85,
    subclassifications: { 'Middle Finger': true },
  },
  {
    label: 'Hate Symbols',
    action: 'flag',
    min_confidence: 80,
    subclassifications: { 'White Supremacy': true, Extremist: true, 'Nazi Party': true },
  },
];

const AI_VIDEO_RULES = [
  { label: 'Explicit', action: 'remove', min_confidence: 50 },
  { label: 'Violence', action: 'flag', min_confidence: 50 },
  { label: 'Visually Disturbing', action: 'remove', min_confidence: 50 },
  { label: 'Drugs & Tobacco', action: 'flag', min_confidence: 50 },
  { label: 'Rude Gestures', action: 'flag', min_confidence: 50 },
  { label: 'Hate Symbols', action: 'remove', min_confidence: 50 },
];

// LLM text rules scoped to media items (e.g. captions) — distinct from the
// gokiro_text/gokiro_text_async policies above.
const MEDIA_LLM_RULES = [
  {
    label: 'SCAM',
    description: 'Fraudulent content, phishing attempts, or deceptive practices',
    action: 'keep',
  },
  {
    label: 'SEXUAL_HARASSMENT',
    description: 'Unwanted sexual advances, comments, or behavior',
    action: 'shadow',
  },
  {
    label: 'HATE_SPEECH',
    description: 'Content that promotes hatred, discrimination, or violence against groups',
    action: 'flag',
  },
  {
    label: 'PII',
    description: 'Personal information like phone numbers, addresses, or private details',
    action: 'keep',
  },
  {
    label: 'PLATFORM_BYPASS',
    description:
      'Content that attempts to move conversation to another platform or suggests external communication platform',
    action: 'keep',
  },
];

async function ensureBlockList({ name, type, words }) {
  try {
    await streamClient.createBlockList({ name, type, words });
    console.log(`Blocklist created: ${name}`);
  } catch (error) {
    if (/exist/i.test(error.message)) {
      await streamClient.updateBlockList({ name, words });
      console.log(`Blocklist updated: ${name}`);
    } else {
      throw error;
    }
  }
}

// Dedicated call type for talent video sessions (kept separate from 'default',
// which regular 1-1 DM calls and demo sessions also use) with frame_recording
// auto-on, so recording starts the instant the call goes live — no manual
// startFrameRecording() call needed, and no frame capture on unrelated call types.
// Cloned from 'default' so existing grants/settings (mute, screenshare, etc.)
// keep working — only frame_recording is added on top.
async function ensureTalentSessionCallType() {
  const defaultType = await streamClient.video.getCallType({ name: 'default' });
  const settings = {
    ...(defaultType.settings || {}),
    frame_recording: {
      ...(defaultType.settings?.frame_recording || {}),
      mode: 'auto-on',
    },
  };
  const grants = defaultType.grants;

  try {
    await streamClient.video.createCallType({ name: 'talent-session', settings, grants });
    console.log('Call type created: talent-session (frame recording auto-on)');
  } catch (error) {
    if (/exist/i.test(error.message)) {
      await streamClient.video.updateCallType({ name: 'talent-session', settings, grants });
      console.log('Call type updated: talent-session (frame recording auto-on)');
    } else {
      throw error;
    }
  }
}

// Dedicated user for automated moderation actions (muteUsers requires either
// muted_by or muted_by_id when called with server-side auth — there's no
// "no attribution" option, so a real user has to exist to attribute it to).
async function ensureSystemUser() {
  await streamClient.upsertUsers([{ id: 'system', name: 'System', role: 'admin' }]);
  console.log('User upserted: system');
}

async function main() {
  await ensureSystemUser();
  await ensureTalentSessionCallType();

  await ensureBlockList(PII_REGEX_LIST);

  await streamClient.moderation.upsertConfig({
    key: SYNC_KEY,
    ai_text_config: { enabled: true, rules: AI_TEXT_RULES_SYNC },
    llm_config: { enabled: true, app_context: APP_CONTEXT, rules: LLM_RULES_SYNC },
    block_list_config: {
      enabled: true,
      rules: [
        { name: 'profanity', action: 'mask' },
        { name: PII_REGEX_LIST.name, action: 'flag' },
      ],
    },
  });
  console.log(`Policy upserted: ${SYNC_KEY}`);

  await streamClient.moderation.upsertConfig({
    key: ASYNC_KEY,
    async: true,
    ai_text_config: { enabled: true, async: true, rules: AI_TEXT_RULES_ASYNC },
    llm_config: { enabled: true, async: true, app_context: APP_CONTEXT, rules: LLM_RULES_ASYNC },
    block_list_config: {
      enabled: true,
      async: true,
      rules: [{ name: 'profanity', action: 'mask' }],
    },
  });
  console.log(`Policy upserted: ${ASYNC_KEY}`);

  await streamClient.moderation.upsertConfig({
    key: MEDIA_KEY,
    async: true,
    ai_image_config: { enabled: true, async: true, rules: AI_IMAGE_RULES },
    ai_video_config: { enabled: true, rules: AI_VIDEO_RULES },
    llm_config: { enabled: true, async: false, rules: MEDIA_LLM_RULES },
  });
  console.log(`Policy upserted: ${MEDIA_KEY}`);

  const config = await streamClient.moderation.getConfig({ key: SYNC_KEY });
  console.log('\nActive sync policy:');
  console.log(JSON.stringify(config, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Moderation config setup failed:', error.message);
    process.exit(1);
  });
