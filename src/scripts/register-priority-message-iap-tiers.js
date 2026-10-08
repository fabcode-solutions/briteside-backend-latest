import 'dotenv/config';
/**
 * src/scripts/register-priority-message-iap-tiers.js
 *
 * One-time (re-runnable) registration of the CONSUMABLE price tiers used by
 * priority-message "Pay in App" (see src/services/priorityMessageIap.service.js)
 * with the App Store and Google Play. Uses the same store credentials as the
 * shop's IAP registration (ShopIapService).
 *
 * Usage (credentials come from AWS Secrets Manager, like the other store scripts):
 *   cross-env NODE_ENV=production USE_AWS_SECRETS=true node src/scripts/register-priority-message-iap-tiers.js
 *
 * Already-registered tiers are reported and skipped (409 from either store).
 *
 * Only some tiers (e.g. just $9.99 for testing):
 *   node src/scripts/register-priority-message-iap-tiers.js --only 999
 *   node src/scripts/register-priority-message-iap-tiers.js --only 499,999
 *
 * Apple note (same as ShopIapService.registerWithApple): this creates each
 * in-app purchase item, but Apple also needs a price schedule + localization
 * per item, and a first-time in-app purchase must pass App Review before it
 * can be bought — finish those in App Store Connect after running this.
 */
import { loadSecrets } from '../config/secrets.js';

// config.js reads process.env at import time — load secrets first.
await loadSecrets();

const { default: config } = await import('../config/config.js');
const { ShopIapService } = await import('../services/shop/shopIap.service.js');
const { PriorityMessageIapService, PRIORITY_IAP_TIERS_CENTS } =
  await import('../services/priorityMessageIap.service.js');

const tierTitle = cents => `Priority Message $${(cents / 100).toFixed(2)}`;

async function registerApple(productId, cents) {
  const token = ShopIapService._ascToken();
  if (!config.appleIap.configured || !config.appleIap.ascAppId || !token) {
    return 'skipped (Apple not configured)';
  }
  const res = await fetch('https://api.appstoreconnect.apple.com/v2/inAppPurchases', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'inAppPurchases',
        attributes: { name: tierTitle(cents), productId, inAppPurchaseType: 'CONSUMABLE' },
        relationships: { app: { data: { type: 'apps', id: config.appleIap.ascAppId } } },
      },
    }),
  });
  if (res.ok) return 'registered';
  if (res.status === 409) return 'already exists';
  return `FAILED ${res.status}: ${await errorDetail(res)}`;
}

/** Store error bodies are multi-line JSON — collapse to one readable line. */
async function errorDetail(res) {
  const body = await res.text().catch(() => '');
  try {
    const json = JSON.parse(body);
    const errors = json.errors ?? (json.error ? [json.error] : []);
    const text = errors
      .map(e => [e.code ?? e.status, e.title, e.detail ?? e.message].filter(Boolean).join(' — '))
      .join('; ');
    if (text) return text;
  } catch {
    // not JSON — fall through to the raw text
  }
  return body.replace(/\s+/g, ' ').slice(0, 500);
}

async function registerGoogle(productId, cents) {
  if (!config.googleIap.configured) return 'skipped (Google not configured)';
  const token = await ShopIapService._googleAccessToken();
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.googleIap.packageName}/inappproducts`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageName: config.googleIap.packageName,
        sku: productId,
        status: 'active',
        // Managed product; the App consumes it after each purchase
        // (finishTransaction isConsumable), which makes it re-buyable.
        purchaseType: 'managedUser',
        defaultLanguage: 'en-US',
        listings: {
          'en-US': {
            title: tierTitle(cents),
            description: 'Send a priority message with a guaranteed reply window.',
          },
        },
        defaultPrice: { priceMicros: String(cents * 10000), currency: 'USD' },
      }),
    }
  );
  if (res.ok) return 'registered';
  if (res.status === 409) return 'already exists';
  const body = await res.text().catch(() => '');
  return `FAILED ${res.status}: ${body.slice(0, 200)}`;
}

// `--only 999` / `--only=499,999` → register just those tiers (cents).
function selectedTiers() {
  const i = process.argv.findIndex(a => a === '--only' || a.startsWith('--only='));
  if (i === -1) return PRIORITY_IAP_TIERS_CENTS;
  const raw = process.argv[i].includes('=') ? process.argv[i].split('=')[1] : process.argv[i + 1];
  const wanted = String(raw ?? '')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(Boolean);
  const unknown = wanted.filter(c => !PRIORITY_IAP_TIERS_CENTS.includes(c));
  if (wanted.length === 0 || unknown.length > 0) {
    console.error(
      `--only must list tier cents from: ${PRIORITY_IAP_TIERS_CENTS.join(', ')}` +
        (unknown.length ? ` (unknown: ${unknown.join(', ')})` : '')
    );
    process.exit(1);
  }
  return wanted;
}

/**
 * Explains a store being skipped or rejected before calling it: checks the
 * shape of each credential (never prints a value).
 */
function preflight() {
  const a = config.appleIap;
  const g = config.googleIap;
  const problems = [];
  if (!/^[0-9a-f-]{36}$/i.test(a.issuerId ?? ''))
    problems.push(
      'APPLE_IAP_ISSUER_ID should be the Issuer ID UUID (App Store Connect → Users and Access → Integrations)'
    );
  if (!/^[A-Z0-9]{10}$/.test(a.ascKeyId ?? ''))
    problems.push(
      'APPLE_ASC_KEY_ID should be the 10-character Key ID of an App Store Connect API Team Key — not its name'
    );
  if (!(a.ascPrivateKey ?? '').includes('BEGIN PRIVATE KEY'))
    problems.push(
      'APPLE_ASC_PRIVATE_KEY should be the full .p8 contents (-----BEGIN PRIVATE KEY----- …)'
    );
  if (!/^\d+$/.test(a.ascAppId ?? ''))
    problems.push(
      "APPLE_ASC_APP_ID should be the app's numeric Apple ID (App Information → Apple ID)"
    );
  if (!g.packageName) problems.push('GOOGLE_PLAY_PACKAGE_NAME is missing (com.gokyro.app)');
  if (!g.serviceAccountJson) problems.push('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is missing');
  else {
    try {
      if (!JSON.parse(g.serviceAccountJson).client_email) throw new Error();
    } catch {
      problems.push(
        'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid one-line JSON with a client_email'
      );
    }
  }
  if (problems.length) {
    console.log('Credential check:');
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log(
      '  (An Apple 401 also happens when APPLE_ASC_* is an In-App Purchase key instead of an App Store Connect API key, or the clock is off.)\n'
    );
  } else {
    console.log('Credential check: all values look well-formed.\n');
  }
}

async function main() {
  const tiers = selectedTiers();
  preflight();
  console.log(`Registering priority-message IAP tiers: ${tiers.join(', ')}\n`);
  let failed = false;
  for (const cents of tiers) {
    const productId = PriorityMessageIapService.productIdForTier(cents);
    const [apple, google] = await Promise.all([
      registerApple(productId, cents).catch(err => `FAILED: ${err.message}`),
      registerGoogle(productId, cents).catch(err => `FAILED: ${err.message}`),
    ]);
    if (apple.startsWith('FAILED') || google.startsWith('FAILED')) failed = true;
    console.log(`  ${productId.padEnd(16)} Apple: ${apple} | Google: ${google}`);
  }
  console.log(failed ? '\nFinished with failures (see above).' : '\nDone.');
  process.exit(failed ? 1 : 0);
}

main();
