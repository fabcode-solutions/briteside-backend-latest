/**
 * Deposit charged at booking for a 'deposit' service, in cents. One rule used
 * by the menu (what the customer is shown) and checkout (what they're charged):
 *   depositPercent set → that % of the price (rounded to the cent)
 *   depositCents set   → that fixed amount
 *   neither            → 20% of the price
 * Never more than the price.
 */
export const DEFAULT_DEPOSIT_PERCENT = 20;

export function serviceDepositCents(service) {
  const price = service.priceCents ?? 0;
  let deposit;
  if (service.depositPercent != null) deposit = Math.round((price * service.depositPercent) / 100);
  else if (service.depositCents != null) deposit = service.depositCents;
  else deposit = Math.round((price * DEFAULT_DEPOSIT_PERCENT) / 100);
  return Math.max(0, Math.min(price, deposit));
}
