/**
 * src/services/iapTiers.js
 *
 * Shared App Store / Google Play price tiers for "Pay in App" — priority
 * messages AND shop items. The stores only sell products created in advance
 * at fixed prices, so in-app payment charges the smallest tier covering the
 * item's exact web price × IAP_MARKUP_MULTIPLIER (the 30% in-app markup):
 * e.g. web $9.68 → $12.58 → tier $12.99.
 *
 * Tiers are CONSUMABLE (the same tier pays for many different messages /
 * items) and are created on both stores automatically by
 * IapCatalogService.sync() (iapCatalog.service.js).
 *
 * Product ids are permanent: App Store ids are unique across the whole
 * developer account and can never be reused, even after deletion — so they
 * carry the bundle id and must never change. Only APPEND tiers.
 */

export const IAP_MARKUP_MULTIPLIER = 1.3;

const IAP_TIER_PREFIX = 'com.gokyro.app.tier_';

const range = (fromCents, toCents, stepCents) => {
  const out = [];
  for (let cents = fromCents; cents <= toCents; cents += stepCents) out.push(cents);
  return out;
};

// $0.99 … $199.99 every $1 (≤ $1 over the exact +30%), then coarser steps up
// to $999.99. Above the top tier the App offers Pay on Web only.
export const IAP_TIER_CENTS = [
  ...range(99, 19999, 100),
  ...range(20999, 49999, 1000),
  ...range(54999, 99999, 5000),
];

export const productIdForTier = tierCents => `${IAP_TIER_PREFIX}${tierCents}`;

export const tierForProductId = productId => {
  if (!productId?.startsWith(IAP_TIER_PREFIX)) return null;
  const cents = Number(productId.slice(IAP_TIER_PREFIX.length));
  return IAP_TIER_CENTS.includes(cents) ? cents : null;
};

/** Smallest tier covering the web price + markup, or null when it's above
 * the largest tier (Pay on Web only). */
export const tierForWebChargedCents = webChargedCents => {
  const target = Math.round(webChargedCents * IAP_MARKUP_MULTIPLIER);
  return IAP_TIER_CENTS.find(cents => cents >= target) ?? null;
};

/** What the App prices "Pay in App" from (plus the store's localized price). */
export const getTierConfig = () => ({
  markupMultiplier: IAP_MARKUP_MULTIPLIER,
  tiers: IAP_TIER_CENTS.map(priceCents => ({
    productId: productIdForTier(priceCents),
    priceCents,
  })),
});
