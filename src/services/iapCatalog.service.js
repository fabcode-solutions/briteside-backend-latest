/**
 * src/services/iapCatalog.service.js
 *
 * Keeps the shared "Pay in App" price tiers (iapTiers.js) created on BOTH
 * stores, automatically — nothing to set up by hand per tier:
 *
 *   App Store Connect: consumable in-app purchase + en-US localization +
 *     USD price (Apple converts other territories) + availability in all
 *     territories + review screenshot (IAP_REVIEW_SCREENSHOT_PATH, optional).
 *     Apple still reviews new in-app purchases: the FIRST ones must be added
 *     to an app version submission in App Store Connect; after that, ready
 *     tiers are submitted automatically.
 *   Google Play: one-time product (new monetization API — the legacy
 *     in-app products API is rejected for this app) with a backwards-
 *     compatible "buy" option priced in every region (Google's own
 *     USD conversion), then activated.
 *
 * Idempotent: lists what each store already has and only creates / completes
 * what's missing, so it's safe to run on every start (cron/iapCatalogSync.js)
 * and by hand (npm run iap:sync-tiers).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { ShopIapService } from './shop/shopIap.service.js';
import { IAP_TIER_CENTS, productIdForTier } from './iapTiers.js';

const ASC = 'https://api.appstoreconnect.apple.com';
const PLAY = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

const TITLE = 'Briteside Purchase';
const APPLE_DESCRIPTION = 'Pays for a priority message or shop item.'; // ≤ 45 chars
const GOOGLE_DESCRIPTION = 'In-app payment for a priority message or a shop item on Briteside.';
const dollars = cents => (cents / 100).toFixed(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── Apple helpers ────────────────────────────────────────────────────────────

// Apple/Google occasionally answer 5xx or 429 under load — retry those a few
// times with backoff before failing the tier (the next sync completes it).
const isRetryable = status => status === 429 || status >= 500;

async function asc(method, urlPath, body, attempt = 0) {
  const res = await fetch(urlPath.startsWith('http') ? urlPath : `${ASC}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${ShopIapService._ascToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (isRetryable(res.status) && attempt < 3) {
    await sleep(2000 * 2 ** attempt);
    return asc(method, urlPath, body, attempt + 1);
  }
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json.errors?.[0];
    const error = new Error(
      `Apple ${method} ${urlPath.split('?')[0]} → ${res.status}${err ? `: ${err.title} — ${err.detail}` : ''}`
    );
    error.status = res.status;
    error.code = err?.code;
    throw error;
  }
  return json;
}

/** Follows `links.next` across pages. */
async function ascAll(urlPath) {
  const items = [];
  let next = urlPath;
  while (next) {
    const page = await asc('GET', next);
    items.push(...(page.data ?? []));
    next = page.links?.next ?? null;
  }
  return items;
}

let territoriesCache = null;
async function appleTerritories() {
  territoriesCache ??= ascAll('/v1/territories?limit=200').then(list =>
    list.map(t => ({ type: 'territories', id: t.id }))
  );
  return territoriesCache;
}

async function applePricePointId(iapId, cents) {
  const wanted = dollars(cents);
  let next = `/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=USA&limit=200`;
  let closestAbove = null;
  while (next) {
    const page = await asc('GET', next);
    for (const point of page.data ?? []) {
      const price = point.attributes.customerPrice;
      if (price === wanted) return point.id;
      if (Number(price) > Number(wanted) && (!closestAbove || Number(price) < closestAbove.price)) {
        closestAbove = { id: point.id, price: Number(price) };
      }
    }
    next = page.links?.next ?? null;
  }
  if (closestAbove) {
    logger.warn(`[IapCatalog] Apple has no $${wanted} price point — using $${closestAbove.price}`);
    return closestAbove.id;
  }
  throw new Error(`Apple has no USD price point at or above $${wanted}`);
}

async function appleHas(iapId, relationship) {
  try {
    const res = await asc('GET', `/v2/inAppPurchases/${iapId}/${relationship}`);
    return Array.isArray(res.data) ? res.data.length > 0 : !!res.data;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

async function uploadAppleReviewScreenshot(iapId, filePath) {
  const file = fs.readFileSync(filePath);
  const reservation = await asc('POST', '/v1/inAppPurchaseAppStoreReviewScreenshots', {
    data: {
      type: 'inAppPurchaseAppStoreReviewScreenshots',
      attributes: { fileName: path.basename(filePath), fileSize: file.length },
      relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } } },
    },
  });
  const { id, attributes } = reservation.data;
  for (const op of attributes.uploadOperations ?? []) {
    const res = await fetch(op.url, {
      method: op.method,
      headers: Object.fromEntries((op.requestHeaders ?? []).map(h => [h.name, h.value])),
      body: file.subarray(op.offset, op.offset + op.length),
    });
    if (!res.ok) throw new Error(`Apple screenshot upload failed (${res.status})`);
  }
  await asc('PATCH', `/v1/inAppPurchaseAppStoreReviewScreenshots/${id}`, {
    data: {
      type: 'inAppPurchaseAppStoreReviewScreenshots',
      id,
      attributes: {
        uploaded: true,
        sourceFileChecksum: crypto.createHash('md5').update(file).digest('hex'),
      },
    },
  });
}

// ── Google helpers ───────────────────────────────────────────────────────────

let googleClientPromise = null;
async function play(method, urlPath, data) {
  googleClientPromise ??= (async () => {
    const { GoogleAuth } = await import('google-auth-library');
    return new GoogleAuth({
      credentials: JSON.parse(config.googleIap.serviceAccountJson),
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    }).getClient();
  })();
  const client = await googleClientPromise;
  let res;
  for (let attempt = 0; ; attempt += 1) {
    res = await client.request({
      url: `${PLAY}/applications/${config.googleIap.packageName}${urlPath}`,
      method,
      data,
      validateStatus: () => true,
    });
    if (!isRetryable(res.status) || attempt >= 3) break;
    await sleep(2000 * 2 ** attempt);
  }
  if (res.status >= 400) {
    const error = new Error(
      `Google ${method} ${urlPath.split('?')[0]} → ${res.status}: ${res.data?.error?.message ?? 'error'}`
    );
    error.status = res.status;
    throw error;
  }
  return res.data ?? {};
}

const toMoney = cents => ({
  currencyCode: 'USD',
  units: String(Math.floor(cents / 100)),
  nanos: (cents % 100) * 10_000_000,
});

// ── Sync ─────────────────────────────────────────────────────────────────────

export class IapCatalogService {
  static appleConfigured() {
    return !!(
      config.appleIap.ascAppId &&
      config.appleIap.ascKeyId &&
      config.appleIap.ascPrivateKey
    );
  }

  static googleConfigured() {
    return !!config.googleIap.configured;
  }

  /**
   * Creates / completes every tier on both stores. `onlyCents` limits it to
   * some tiers; `dryRun` only reports what would change.
   * Returns { apple: {created, completed, ok, failed}, google: {...} }.
   */
  static async sync({ onlyCents = null, dryRun = false, log = msg => logger.info(msg) } = {}) {
    const tiers = onlyCents ? IAP_TIER_CENTS.filter(c => onlyCents.includes(c)) : IAP_TIER_CENTS;
    const result = {};
    if (this.appleConfigured()) result.apple = await this.syncApple(tiers, { dryRun, log });
    else log('[IapCatalog] Apple skipped — APPLE_ASC_* not configured');
    if (this.googleConfigured()) result.google = await this.syncGoogle(tiers, { dryRun, log });
    else log('[IapCatalog] Google skipped — GOOGLE_PLAY_* not configured');
    return result;
  }

  static async syncApple(tiers, { dryRun, log }) {
    const stats = { created: 0, completed: 0, ok: 0, failed: 0 };
    const existing = new Map(
      (await ascAll(`/v1/apps/${config.appleIap.ascAppId}/inAppPurchasesV2?limit=200`)).map(
        item => [item.attributes.productId, { id: item.id, state: item.attributes.state }]
      )
    );
    const screenshotPath = process.env.IAP_REVIEW_SCREENSHOT_PATH;
    const hasScreenshotFile = !!screenshotPath && fs.existsSync(screenshotPath);

    for (const cents of tiers) {
      const productId = productIdForTier(cents);
      try {
        let item = existing.get(productId);
        if (item && item.state !== 'MISSING_METADATA') {
          stats.ok += 1;
          if (item.state === 'READY_TO_SUBMIT' && !dryRun) await this.trySubmitApple(item.id, log);
          continue;
        }
        if (dryRun) {
          log(`[IapCatalog] Apple ${productId}: would ${item ? 'complete' : 'create'}`);
          continue;
        }

        if (!item) {
          const created = await asc('POST', '/v2/inAppPurchases', {
            data: {
              type: 'inAppPurchases',
              attributes: {
                name: `Tier $${dollars(cents)}`, // reference name, unique per app
                productId,
                inAppPurchaseType: 'CONSUMABLE',
                reviewNote:
                  'Price tier used to pay for a priority message or a shop item at its web price + 30%.',
              },
              relationships: { app: { data: { type: 'apps', id: config.appleIap.ascAppId } } },
            },
          });
          item = { id: created.data.id, state: created.data.attributes.state };
          stats.created += 1;
        } else {
          stats.completed += 1;
        }

        if (!(await appleHas(item.id, 'inAppPurchaseLocalizations'))) {
          await asc('POST', '/v1/inAppPurchaseLocalizations', {
            data: {
              type: 'inAppPurchaseLocalizations',
              attributes: { locale: 'en-US', name: TITLE, description: APPLE_DESCRIPTION },
              relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: item.id } } },
            },
          });
        }
        if (!(await appleHas(item.id, 'iapPriceSchedule'))) {
          const pricePointId = await applePricePointId(item.id, cents);
          await asc('POST', '/v1/inAppPurchasePriceSchedules', {
            data: {
              type: 'inAppPurchasePriceSchedules',
              relationships: {
                inAppPurchase: { data: { type: 'inAppPurchases', id: item.id } },
                baseTerritory: { data: { type: 'territories', id: 'USA' } },
                manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price}' }] },
              },
            },
            included: [
              {
                type: 'inAppPurchasePrices',
                id: '${price}',
                attributes: { startDate: null },
                relationships: {
                  inAppPurchasePricePoint: {
                    data: { type: 'inAppPurchasePricePoints', id: pricePointId },
                  },
                },
              },
            ],
          });
        }
        if (!(await appleHas(item.id, 'inAppPurchaseAvailability'))) {
          await asc('POST', '/v1/inAppPurchaseAvailabilities', {
            data: {
              type: 'inAppPurchaseAvailabilities',
              attributes: { availableInNewTerritories: true },
              relationships: {
                inAppPurchase: { data: { type: 'inAppPurchases', id: item.id } },
                availableTerritories: { data: await appleTerritories() },
              },
            },
          });
        }
        if (hasScreenshotFile && !(await appleHas(item.id, 'appStoreReviewScreenshot'))) {
          await uploadAppleReviewScreenshot(item.id, screenshotPath);
        }
        log(`[IapCatalog] Apple ${productId}: set up ($${dollars(cents)})`);
        await sleep(200); // stay well under App Store Connect's rate limit
      } catch (err) {
        stats.failed += 1;
        log(`[IapCatalog] Apple ${productId}: FAILED — ${err.message}`);
      }
    }
    if (!hasScreenshotFile) {
      log(
        '[IapCatalog] Apple: no review screenshot uploaded (set IAP_REVIEW_SCREENSHOT_PATH to a PNG/JPG of the in-app payment screen) — Apple needs one before review'
      );
    }
    return stats;
  }

  /** After the first in-app purchases are approved (with an app version),
   * new tiers can be submitted on their own. Before that Apple refuses —
   * those get included in the next app version submission instead. */
  static async trySubmitApple(iapId, log) {
    try {
      await asc('POST', '/v1/inAppPurchaseSubmissions', {
        data: {
          type: 'inAppPurchaseSubmissions',
          relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } } },
        },
      });
    } catch (err) {
      if (!this._appleSubmitWarned) {
        this._appleSubmitWarned = true;
        log(
          `[IapCatalog] Apple: tiers are ready but can't be submitted on their own yet (${err.message}) — add them to the next app version submission in App Store Connect`
        );
      }
    }
  }

  static async syncGoogle(tiers, { dryRun, log }) {
    const stats = { created: 0, completed: 0, ok: 0, failed: 0 };
    const existing = new Map();
    let pageToken;
    do {
      const page = await play(
        'GET',
        `/oneTimeProducts?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`
      );
      for (const product of page.oneTimeProducts ?? []) existing.set(product.productId, product);
      pageToken = page.nextPageToken;
    } while (pageToken);

    for (const cents of tiers) {
      const productId = productIdForTier(cents);
      try {
        const product = existing.get(productId);
        const buyOption = product?.purchaseOptions?.find(o => o.purchaseOptionId === 'buy');
        if (buyOption?.state === 'ACTIVE') {
          stats.ok += 1;
          continue;
        }
        if (dryRun) {
          log(`[IapCatalog] Google ${productId}: would ${product ? 'activate' : 'create'}`);
          continue;
        }

        if (!buyOption) {
          const converted = await play('POST', '/pricing:convertRegionPrices', {
            price: toMoney(cents),
          });
          const regional = Object.values(converted.convertedRegionPrices ?? {}).map(region => ({
            regionCode: region.regionCode,
            price: region.price,
            availability: 'AVAILABLE',
          }));
          await play(
            'PATCH',
            // Google's patch path is lowercase `onetimeproducts` (unlike its
            // other endpoints) — per the API's discovery document.
            `/onetimeproducts/${productId}?allowMissing=true&regionsVersion.version=2022%2F02` +
              '&updateMask=listings,purchaseOptions',
            {
              packageName: config.googleIap.packageName,
              productId,
              listings: [{ languageCode: 'en-US', title: TITLE, description: GOOGLE_DESCRIPTION }],
              purchaseOptions: [
                {
                  purchaseOptionId: 'buy',
                  // legacyCompatible: purchases.products.get (the backend's
                  // purchase verification) only sees backwards-compatible options.
                  buyOption: { legacyCompatible: true, multiQuantityEnabled: false },
                  regionalPricingAndAvailabilityConfigs: regional,
                  ...(converted.convertedOtherRegionsPrice && {
                    newRegionsConfig: {
                      usdPrice: converted.convertedOtherRegionsPrice.usdPrice,
                      eurPrice: converted.convertedOtherRegionsPrice.eurPrice,
                      availability: 'AVAILABLE',
                    },
                  }),
                },
              ],
            }
          );
          if (product) stats.completed += 1;
          else stats.created += 1;
        } else {
          stats.completed += 1;
        }

        await play('POST', `/oneTimeProducts/${productId}/purchaseOptions:batchUpdateStates`, {
          requests: [
            {
              activatePurchaseOptionRequest: {
                packageName: config.googleIap.packageName,
                productId,
                purchaseOptionId: 'buy',
              },
            },
          ],
        });
        log(`[IapCatalog] Google ${productId}: set up and active ($${dollars(cents)})`);
      } catch (err) {
        stats.failed += 1;
        log(`[IapCatalog] Google ${productId}: FAILED — ${err.message}`);
      }
    }
    return stats;
  }
}
