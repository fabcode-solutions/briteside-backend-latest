/**
 * Service sales: a business marks services salePercent off between
 * saleStartsAt (NULL = already started) and saleEndsAt (NULL = until ended).
 * The discount applies to the price as booked — per-location prices included —
 * so deposits (% ones), the booking fee tier and Briteside's 5% follow it.
 */

export const MAX_SALE_PERCENT = 90;

const time = v => (v == null ? null : new Date(v).getTime());

/** 'active' | 'scheduled' | 'ended' | null (no sale set). */
export function saleStatus(service, now = Date.now()) {
  // "Starts from" services go on sale too: their public starting price drops (the
  // customer still books through a custom offer, priced by the business)
  if (service?.salePercent == null) return null;
  const start = time(service.saleStartsAt);
  const end = time(service.saleEndsAt);
  if (end != null && end <= now) return 'ended';
  if (start != null && start > now) return 'scheduled';
  return 'active';
}

export const saleActive = (service, now = Date.now()) => saleStatus(service, now) === 'active';

/** The price after `percent` off, rounded to the cent. */
export const salePriceCents = (priceCents, percent) => Math.round((priceCents * (100 - percent)) / 100);

/**
 * The service as charged right now: its price with the sale taken off while
 * one is running (listPriceCents keeps the price before the discount).
 * Apply after serviceAtLocation so a location's own price is discounted too.
 */
export function withSale(service, now = Date.now()) {
  if (!saleActive(service, now)) return service;
  return {
    ...service,
    listPriceCents: service.priceCents,
    priceCents: salePriceCents(service.priceCents, service.salePercent),
  };
}
